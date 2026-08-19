import { describe, expect, it, vi } from "vitest";

import type { PreflightReport } from "@token2022-preflight/core";
import { PreflightError } from "@token2022-preflight/solana";
import { runCli, type CliIo } from "../src/index.js";

const MINT = "11111111111111111111111111111111";

function report(
  overallStatus: PreflightReport["overallStatus"],
): PreflightReport {
  return {
    schemaVersion: "1.0",
    engineVersion: "0.1.0",
    generatedAt: "2026-08-19T00:00:00.000Z",
    cluster: "devnet",
    input: { mint: MINT },
    tokenProgram: "token-2022",
    mint: {
      address: MINT,
      decimals: 6,
      supplyRaw: "1000000",
      mintAuthority: null,
      freezeAuthority: null,
      extensions: [],
    },
    overallStatus,
    findings: [],
    limitations: ["No transaction simulation is performed."],
  };
}

function io(): CliIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
  };
}

describe("runCli", () => {
  it.each([
    ["READY", 0],
    ["WARNING", 0],
    ["ACTION_REQUIRED", 2],
    ["BLOCKED", 3],
    ["UNKNOWN", 4],
  ] as const)("maps %s to exit code %i", async (status, expectedCode) => {
    const output = io();
    const result = await runCli(
      ["inspect", MINT, "--json", "--cluster", "devnet"],
      {},
      output,
      async () => report(status),
    );
    expect(result).toBe(expectedCode);
  });

  it("writes only valid report JSON to stdout in JSON mode", async () => {
    const output = io();
    await runCli(["inspect", MINT, "--json"], {}, output, async () =>
      report("READY"),
    );

    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({
      schemaVersion: "1.0",
      overallStatus: "READY",
    });
  });

  it("uses flag RPC URL before the environment value", async () => {
    const output = io();
    const analyze = vi.fn(async () => report("READY"));
    await runCli(
      [
        "inspect",
        MINT,
        "--rpc-url",
        "https://flag.example",
        "--cluster",
        "devnet",
      ],
      { SOLANA_RPC_URL: "https://env.example" },
      output,
      analyze,
    );

    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        rpcUrl: "https://flag.example",
        cluster: "devnet",
        timeoutMs: 10_000,
      }),
    );
  });

  it("prints a readable terminal report", async () => {
    const output = io();
    await runCli(["inspect", MINT, "--no-color"], {}, output, async () =>
      report("WARNING"),
    );

    expect(output.stdout.join("")).toContain("Token-2022 Preflight");
    expect(output.stdout.join("")).toContain("Status     WARNING");
  });

  it("returns exit code 1 and explains an invalid amount", async () => {
    const output = io();
    const result = await runCli(
      ["inspect", MINT, "--amount", "1.0000001"],
      {},
      output,
      async () => {
        throw new PreflightError(
          "INVALID_AMOUNT",
          "Amount has more than 6 decimal places",
        );
      },
    );

    expect(result).toBe(1);
    expect(output.stderr.join("")).toContain(
      "Amount has more than 6 decimal places",
    );
  });

  it("prints required actions and labels UI and raw amounts", async () => {
    const output = io();
    const value = report("ACTION_REQUIRED");
    value.input.amountUi = "1.5";
    value.transfer = { amountRaw: "1500000" };
    value.findings = [
      {
        id: "memo",
        status: "ACTION_REQUIRED",
        category: "account",
        title: "Memo required",
        summary: "Destination requires a memo.",
        requiredActions: ["Add a Memo instruction."],
        evidence: [],
      },
    ];

    await runCli(
      ["inspect", MINT, "--no-color"],
      {},
      output,
      async () => value,
    );

    expect(output.stdout.join("")).toContain("Amount (UI)  1.5");
    expect(output.stdout.join("")).toContain("Amount (raw) 1500000");
    expect(output.stdout.join("")).toContain("Add a Memo instruction.");
  });

  it("prints finding diagnostics only with --verbose", async () => {
    const output = io();
    const value = report("WARNING");
    value.findings = [
      {
        id: "delegate",
        status: "WARNING",
        category: "authority",
        title: "Permanent delegate",
        summary: "Delegate can move funds.",
        requiredActions: [],
        evidence: [
          {
            account: MINT,
            accountKind: "mint",
            field: "delegate",
            value: MINT,
          },
        ],
        technicalDetails: { authority: MINT },
      },
    ];

    await runCli(
      ["inspect", MINT, "--verbose", "--no-color"],
      {},
      output,
      async () => value,
    );

    expect(output.stdout.join("")).toContain("Delegate can move funds.");
    expect(output.stdout.join("")).toContain("delegate:");
    expect(output.stdout.join("")).toContain("authority:");
  });
});
