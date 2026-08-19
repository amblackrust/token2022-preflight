import { address, none, some } from "@solana/kit";
import {
  extension,
  AccountState,
  getMintEncoder,
  getTokenEncoder,
  TOKEN_2022_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { describe, expect, it } from "vitest";

import {
  decodeMintData,
  decodeTokenData,
  detectTokenProgram,
  type PreflightError,
} from "../src/index.js";

const MINT = address("11111111111111111111111111111111");
const AUTHORITY = address("SysvarRent111111111111111111111111111111111");

describe("detectTokenProgram", () => {
  it("distinguishes legacy and Token-2022 account owners", () => {
    expect(detectTokenProgram(TOKEN_PROGRAM_ADDRESS)).toBe("legacy");
    expect(detectTokenProgram(TOKEN_2022_PROGRAM_ADDRESS)).toBe("token-2022");
  });

  it("rejects an account owned by another program", () => {
    expect(() => detectTokenProgram(MINT)).toThrowError(
      expect.objectContaining<Partial<PreflightError>>({
        code: "UNSUPPORTED_OWNER",
      }),
    );
  });
});

describe("decodeTokenData", () => {
  it("normalizes account state and account-level extensions", () => {
    const data = getTokenEncoder().encode({
      mint: MINT,
      owner: AUTHORITY,
      amount: 500n,
      delegate: none(),
      state: AccountState.Frozen,
      isNative: none(),
      delegatedAmount: 0n,
      closeAuthority: none(),
      extensions: some([
        extension("MemoTransfer", { requireIncomingTransferMemos: true }),
        extension("CpiGuard", { lockCpi: true }),
        extension("ImmutableOwner"),
      ]),
    });

    expect(decodeTokenData(AUTHORITY, data, MINT)).toEqual({
      address: AUTHORITY,
      state: "frozen",
      extensions: [
        { kind: "MemoTransfer", requireIncomingTransferMemos: true },
        { kind: "CpiGuard", enabled: true },
        { kind: "ImmutableOwner", enabled: true },
      ],
    });
  });

  it("rejects a token account for another mint", () => {
    const otherMint = address("SysvarC1ock11111111111111111111111111111111");
    const data = getTokenEncoder().encode({
      mint: otherMint,
      owner: AUTHORITY,
      amount: 0n,
      delegate: none(),
      state: AccountState.Initialized,
      isNative: none(),
      delegatedAmount: 0n,
      closeAuthority: none(),
      extensions: none(),
    });

    expect(() => decodeTokenData(AUTHORITY, data, MINT)).toThrowError(
      expect.objectContaining<Partial<PreflightError>>({
        code: "MINT_MISMATCH",
      }),
    );
  });
});

describe("decodeMintData", () => {
  it("decodes and normalizes official Token-2022 extension data", () => {
    const data = getMintEncoder().encode({
      mintAuthority: none(),
      supply: 50_000n,
      decimals: 2,
      isInitialized: true,
      freezeAuthority: some(AUTHORITY),
      extensions: some([
        extension("NonTransferable", {}),
        extension("PermanentDelegate", { delegate: AUTHORITY }),
        extension("PausableConfig", {
          authority: some(AUTHORITY),
          paused: false,
        }),
      ]),
    });

    expect(decodeMintData(MINT, data)).toEqual({
      address: MINT,
      decimals: 2,
      supplyRaw: 50_000n,
      mintAuthority: null,
      freezeAuthority: AUTHORITY,
      extensions: [
        { kind: "NonTransferable" },
        { kind: "PermanentDelegate", delegate: AUTHORITY },
        { kind: "PausableConfig", authority: AUTHORITY, paused: false },
      ],
    });
  });

  it("maps malformed mint bytes to a safe domain error", () => {
    expect(() => decodeMintData(MINT, new Uint8Array([1, 2, 3]))).toThrowError(
      expect.objectContaining<Partial<PreflightError>>({
        code: "MINT_DECODE_FAILED",
      }),
    );
  });
});
