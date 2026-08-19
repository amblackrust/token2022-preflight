import { describe, expect, it } from "vitest";

import {
  analyzeNormalizedToken,
  type NormalizedAnalysis,
} from "../src/index.js";

const MINT = "Mint111111111111111111111111111111111111111";
const SOURCE = "Source1111111111111111111111111111111111111";
const DESTINATION = "Dest111111111111111111111111111111111111111";

function analysis(overrides: Record<string, unknown> = {}): NormalizedAnalysis {
  return {
    cluster: "devnet",
    tokenProgram: "token-2022",
    mint: {
      address: MINT,
      decimals: 2,
      supplyRaw: 1_000_000n,
      mintAuthority: null,
      freezeAuthority: null,
      extensions: [],
    },
    ...overrides,
  } as unknown as NormalizedAnalysis;
}

describe("transfer-aware rules", () => {
  it("calculates the epoch-selected transfer fee with a maximum cap", () => {
    const report = analyzeNormalizedToken(
      analysis({
        amountUi: "1000",
        currentEpoch: 42n,
        mint: {
          ...analysis().mint,
          extensions: [
            {
              kind: "TransferFeeConfig",
              older: { epoch: 0n, basisPoints: 100, maximumFeeRaw: 500n },
              newer: { epoch: 40n, basisPoints: 250, maximumFeeRaw: 1_000n },
              configAuthority: "Config111111111111111111111111111111111111",
              withdrawAuthority: null,
            },
          ],
        },
      }),
    );

    expect(report.overallStatus).toBe("ACTION_REQUIRED");
    expect(report.transfer).toEqual({
      amountRaw: "100000",
      expectedFeeRaw: "1000",
      expectedReceivedRaw: "99000",
    });
    expect(report.findings[0]).toMatchObject({
      id: "transfer-fee",
      technicalDetails: { basisPoints: 250, maximumFeeRaw: "1000" },
    });
  });

  it("blocks a paused mint and reports its authority", () => {
    const report = analyzeNormalizedToken(
      analysis({
        mint: {
          ...analysis().mint,
          extensions: [
            {
              kind: "PausableConfig",
              paused: true,
              authority: "Pause1111111111111111111111111111111111111",
            },
          ],
        },
      }),
    );

    expect(report.overallStatus).toBe("BLOCKED");
    expect(report.findings[0]).toMatchObject({
      id: "mint-paused",
      status: "BLOCKED",
    });
  });

  it("warns for default-frozen state without claiming existing accounts are frozen", () => {
    const report = analyzeNormalizedToken(
      analysis({
        mint: {
          ...analysis().mint,
          extensions: [{ kind: "DefaultAccountState", state: "frozen" }],
        },
      }),
    );

    expect(report.overallStatus).toBe("WARNING");
    expect(report.findings[0]).toMatchObject({
      id: "default-account-state-frozen",
      status: "WARNING",
    });
  });

  it("blocks a frozen source and requires a memo for the destination", () => {
    const report = analyzeNormalizedToken(
      analysis({
        sourceTokenAccount: {
          address: SOURCE,
          state: "frozen",
          extensions: [],
        },
        destinationTokenAccount: {
          address: DESTINATION,
          state: "initialized",
          extensions: [
            { kind: "MemoTransfer", requireIncomingTransferMemos: true },
          ],
        },
      }),
    );

    expect(report.overallStatus).toBe("BLOCKED");
    expect(report.findings.map(({ id }) => id)).toEqual([
      "source-frozen",
      "destination-memo-required",
    ]);
  });

  it("keeps a transfer-hook action while separately reporting unresolved accounts", () => {
    const report = analyzeNormalizedToken(
      analysis({
        mint: {
          ...analysis().mint,
          extensions: [
            {
              kind: "TransferHook",
              programAddress: "Hook111111111111111111111111111111111111111",
              resolution: {
                status: "unresolved",
                reason: "meta account not found",
              },
            },
          ],
        },
      }),
    );

    expect(report.findings.map(({ id }) => id)).toEqual([
      "transfer-hook",
      "transfer-hook-unresolved",
    ]);
  });

  it("includes resolved Transfer Hook accounts in the finding", () => {
    const report = analyzeNormalizedToken(
      analysis({
        mint: {
          ...analysis().mint,
          extensions: [
            {
              kind: "TransferHook",
              programAddress: "Hook111111111111111111111111111111111111111",
              resolution: {
                status: "resolved",
                accounts: ["Meta111111111111111111111111111111111111111"],
              },
            },
          ],
        },
      }),
    );

    expect(report.findings[0]).toMatchObject({
      id: "transfer-hook",
      technicalDetails: {
        additionalAccounts: ["Meta111111111111111111111111111111111111111"],
      },
    });
  });

  it("warns about a permanent delegate and marks confidential transfer unsupported", () => {
    const report = analyzeNormalizedToken(
      analysis({
        mint: {
          ...analysis().mint,
          extensions: [
            {
              kind: "PermanentDelegate",
              delegate: "Delegate11111111111111111111111111111111111",
            },
            { kind: "ConfidentialTransferMint" },
          ],
        },
      }),
    );

    expect(report.overallStatus).toBe("UNKNOWN");
    expect(report.findings.map(({ status }) => status)).toEqual([
      "UNKNOWN",
      "WARNING",
    ]);
  });
});
