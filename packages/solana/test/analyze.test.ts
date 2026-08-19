import { address, none } from "@solana/kit";
import {
  AccountState,
  extension,
  getMintEncoder,
  getTokenEncoder,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { describe, expect, it, vi } from "vitest";

import {
  analyzeTokenTransfer,
  type AccountReader,
  type PreflightError,
} from "../src/index.js";

const MINT = address("11111111111111111111111111111111");
const SOURCE = address("SysvarC1ock11111111111111111111111111111111");
const DESTINATION = address("SysvarRent111111111111111111111111111111111");
const mintData = getMintEncoder().encode({
  mintAuthority: none(),
  supply: 100n,
  decimals: 2,
  isInitialized: true,
  freezeAuthority: none(),
  extensions: none(),
});

function reader(
  account: Awaited<ReturnType<AccountReader["getAccount"]>>,
): AccountReader {
  return {
    getAccount: async () => account,
    getEpoch: async () => 10n,
  };
}

describe("analyzeTokenTransfer", () => {
  it("fetches and analyzes a Token-2022 mint without a backend", async () => {
    const report = await analyzeTokenTransfer(
      {
        cluster: "devnet",
        rpcUrl: "http://localhost:8899",
        mint: MINT,
        amountUi: "1",
      },
      { reader: reader({ owner: TOKEN_2022_PROGRAM_ADDRESS, data: mintData }) },
    );

    expect(report).toMatchObject({
      cluster: "devnet",
      tokenProgram: "token-2022",
      overallStatus: "READY",
      transfer: { amountRaw: "100" },
    });
  });

  it("maps a missing mint to ACCOUNT_NOT_FOUND", async () => {
    await expect(
      analyzeTokenTransfer(
        { cluster: "devnet", rpcUrl: "http://localhost:8899", mint: MINT },
        { reader: reader(null) },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PreflightError>>({
        code: "ACCOUNT_NOT_FOUND",
      }),
    );
  });

  it("returns a BLOCKED report for an unsupported account owner", async () => {
    const result = await analyzeTokenTransfer(
      { cluster: "devnet", rpcUrl: "http://localhost:8899", mint: MINT },
      { reader: reader({ owner: MINT, data: mintData }) },
    );

    expect(result).toMatchObject({
      tokenProgram: "unsupported",
      overallStatus: "BLOCKED",
      findings: [{ id: "unsupported-owner", status: "BLOCKED" }],
    });
  });

  it("returns an UNKNOWN partial report when mint decoding fails", async () => {
    const result = await analyzeTokenTransfer(
      { cluster: "devnet", rpcUrl: "http://localhost:8899", mint: MINT },
      {
        reader: reader({
          owner: TOKEN_2022_PROGRAM_ADDRESS,
          data: new Uint8Array([1, 2, 3]),
        }),
      },
    );

    expect(result).toMatchObject({
      tokenProgram: "token-2022",
      overallStatus: "UNKNOWN",
      findings: [{ id: "mint-decode-failed", status: "UNKNOWN" }],
    });
  });

  it("rejects source and destination unless both are provided", async () => {
    await expect(
      analyzeTokenTransfer(
        {
          cluster: "devnet",
          rpcUrl: "http://localhost:8899",
          mint: MINT,
          sourceTokenAccount: MINT,
        },
        {
          reader: reader({ owner: TOKEN_2022_PROGRAM_ADDRESS, data: mintData }),
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PreflightError>>({
        code: "INVALID_ADDRESS",
      }),
    );
  });

  it("fetches transfer accounts and applies destination memo rules", async () => {
    const tokenData = (memoRequired: boolean) =>
      getTokenEncoder().encode({
        mint: MINT,
        owner: SOURCE,
        amount: 100n,
        delegate: none(),
        state: AccountState.Initialized,
        isNative: none(),
        delegatedAmount: 0n,
        closeAuthority: none(),
        extensions: memoRequired
          ? {
              __option: "Some",
              value: [
                extension("MemoTransfer", {
                  requireIncomingTransferMemos: true,
                }),
              ],
            }
          : none(),
      });
    const accounts = new Map<
      string,
      { owner: typeof TOKEN_2022_PROGRAM_ADDRESS; data: Uint8Array }
    >([
      [MINT, { owner: TOKEN_2022_PROGRAM_ADDRESS, data: mintData }],
      [SOURCE, { owner: TOKEN_2022_PROGRAM_ADDRESS, data: tokenData(false) }],
      [
        DESTINATION,
        { owner: TOKEN_2022_PROGRAM_ADDRESS, data: tokenData(true) },
      ],
    ]);
    const accountReader: AccountReader = {
      getAccount: async (accountAddress) =>
        accounts.get(accountAddress) ?? null,
      getEpoch: async () => 0n,
    };

    const report = await analyzeTokenTransfer(
      {
        cluster: "devnet",
        rpcUrl: "http://localhost:8899",
        mint: MINT,
        sourceTokenAccount: SOURCE,
        destinationTokenAccount: DESTINATION,
      },
      { reader: accountReader },
    );

    expect(report.findings).toEqual([
      expect.objectContaining({
        id: "destination-memo-required",
        status: "ACTION_REQUIRED",
      }),
    ]);
  });

  it("resolves Transfer Hook additional accounts for a complete scenario", async () => {
    const hookMintData = getMintEncoder().encode({
      mintAuthority: none(),
      supply: 100n,
      decimals: 2,
      isInitialized: true,
      freezeAuthority: none(),
      extensions: {
        __option: "Some",
        value: [
          extension("TransferHook", {
            authority: SOURCE,
            programId: DESTINATION,
          }),
        ],
      },
    });
    const tokenData = getTokenEncoder().encode({
      mint: MINT,
      owner: SOURCE,
      amount: 100n,
      delegate: none(),
      state: AccountState.Initialized,
      isNative: none(),
      delegatedAmount: 0n,
      closeAuthority: none(),
      extensions: none(),
    });
    const resolveTransferHook = vi.fn(async () => [
      "Meta111111111111111111111111111111111111111",
    ]);
    const accountReader = {
      getAccount: async (accountAddress: string) => {
        if (accountAddress === MINT)
          return { owner: TOKEN_2022_PROGRAM_ADDRESS, data: hookMintData };
        return { owner: TOKEN_2022_PROGRAM_ADDRESS, data: tokenData };
      },
      getEpoch: async () => 0n,
      resolveTransferHook,
    };

    const result = await analyzeTokenTransfer(
      {
        cluster: "devnet",
        rpcUrl: "http://localhost:8899",
        mint: MINT,
        amountUi: "1",
        sourceTokenAccount: SOURCE,
        destinationTokenAccount: DESTINATION,
      },
      { reader: accountReader },
    );

    expect(resolveTransferHook).toHaveBeenCalledOnce();
    expect(result.findings[0]).toMatchObject({
      id: "transfer-hook",
      technicalDetails: {
        additionalAccounts: ["Meta111111111111111111111111111111111111111"],
      },
    });
  });
});
