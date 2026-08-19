import { describe, expect, it } from "vitest";

import { analyzeTokenTransfer } from "@token2022-preflight/solana";

const rpcUrl = process.env.LIVE_DEVNET_RPC_URL;
const legacyMint = process.env.LIVE_DEVNET_LEGACY_MINT;
const token2022Mint = process.env.LIVE_DEVNET_TOKEN_2022_MINT;
const runLive =
  process.env.RUN_LIVE_TESTS === "1" &&
  rpcUrl !== undefined &&
  legacyMint !== undefined &&
  token2022Mint !== undefined;

describe.skipIf(!runLive)("devnet live analysis", () => {
  it("detects a configured legacy mint", async () => {
    const report = await analyzeTokenTransfer({
      cluster: "devnet",
      rpcUrl: rpcUrl!,
      mint: legacyMint!,
      timeoutMs: 15_000,
    });

    expect(report.tokenProgram).toBe("legacy");
  });

  it("decodes a configured Token-2022 mint", async () => {
    const report = await analyzeTokenTransfer({
      cluster: "devnet",
      rpcUrl: rpcUrl!,
      mint: token2022Mint!,
      timeoutMs: 15_000,
    });

    expect(report.tokenProgram).toBe("token-2022");
    expect(report.schemaVersion).toBe("1.0");
  });
});
