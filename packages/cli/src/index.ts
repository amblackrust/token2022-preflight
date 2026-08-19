import { Command, CommanderError, Option } from "commander";
import pc from "picocolors";

import type { FindingStatus, PreflightReport } from "@token2022-preflight/core";
import {
  analyzeTokenTransfer,
  PreflightError,
  type AnalyzeTokenTransferInput,
} from "@token2022-preflight/solana";

const PACKAGE_VERSION = "0.1.0";
const DEFAULT_RPC_URLS = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
} as const;
const EXIT_CODES: Readonly<Record<FindingStatus, number>> = {
  READY: 0,
  WARNING: 0,
  ACTION_REQUIRED: 2,
  BLOCKED: 3,
  UNKNOWN: 4,
};

export interface CliIo {
  writeStdout(value: string): void;
  writeStderr(value: string): void;
}

export type Analyze = (
  input: AnalyzeTokenTransferInput,
) => Promise<PreflightReport>;

interface InspectOptions {
  cluster: "mainnet-beta" | "devnet";
  rpcUrl?: string;
  amount?: string;
  source?: string;
  destination?: string;
  json?: boolean;
  color: boolean;
  verbose?: boolean;
  timeout: string;
}

export async function runCli(
  argv: string[],
  env: Readonly<Record<string, string | undefined>>,
  io: CliIo,
  analyze: Analyze = analyzeTokenTransfer,
): Promise<number> {
  let exitCode = 0;
  const program = new Command()
    .name("token22")
    .description("Explain how a Solana token affects a transfer flow")
    .version(PACKAGE_VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (value) => io.writeStdout(value),
      writeErr: (value) => io.writeStderr(value),
    });

  program
    .command("inspect")
    .description("Inspect a mint and optional token-account transfer scenario")
    .argument("<mint>", "Solana mint address")
    .addOption(
      new Option("--cluster <cluster>")
        .choices(["mainnet-beta", "devnet"])
        .default("mainnet-beta"),
    )
    .option("--rpc-url <url>", "custom Solana RPC endpoint")
    .option("--amount <decimal>", "amount in UI units")
    .option("--source <address>", "source token account")
    .option("--destination <address>", "destination token account")
    .option("--json", "write only JSON to stdout")
    .option("--no-color", "disable ANSI colors")
    .option("--verbose", "include technical diagnostics")
    .option("--timeout <ms>", "RPC timeout in milliseconds", "10000")
    .action(async (mint: string, options: InspectOptions) => {
      try {
        validateTimeout(options.timeout);
        const rpcUrl =
          options.rpcUrl ??
          env.SOLANA_RPC_URL ??
          DEFAULT_RPC_URLS[options.cluster];
        const input: AnalyzeTokenTransferInput = {
          cluster: options.cluster,
          rpcUrl,
          mint,
          ...(options.amount === undefined ? {} : { amountUi: options.amount }),
          ...(options.source === undefined
            ? {}
            : { sourceTokenAccount: options.source }),
          ...(options.destination === undefined
            ? {}
            : { destinationTokenAccount: options.destination }),
        };
        const report = await analyze(input);
        io.writeStdout(
          options.json
            ? `${JSON.stringify(report, null, 2)}\n`
            : formatTerminalReport(report, options.color),
        );
        exitCode = EXIT_CODES[report.overallStatus];
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected error";
        io.writeStderr(`${message}\n`);
        if (
          options.verbose &&
          error instanceof Error &&
          error.stack !== undefined
        ) {
          io.writeStderr(`${error.stack}\n`);
        }
        exitCode = 1;
      }
    });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    throw error;
  }
  return exitCode;
}

export function formatTerminalReport(
  report: PreflightReport,
  color: boolean,
): string {
  const paint = color
    ? statusColor(report.overallStatus)
    : (value: string) => value;
  const lines = [
    "Token-2022 Preflight",
    "",
    `Mint       ${report.mint.address}`,
    `Cluster    ${report.cluster}`,
    `Program    ${report.tokenProgram === "token-2022" ? "Token-2022" : report.tokenProgram}`,
    `Status     ${paint(report.overallStatus.replace("_", " "))}`,
  ];
  if (report.transfer !== undefined) {
    lines.push(
      "",
      "Transfer",
      `  Send       ${report.transfer.amountRaw ?? "unknown"}`,
    );
    if (report.transfer.expectedFeeRaw !== undefined)
      lines.push(`  Fee        ${report.transfer.expectedFeeRaw}`);
    if (report.transfer.expectedReceivedRaw !== undefined)
      lines.push(`  Receive    ${report.transfer.expectedReceivedRaw}`);
  }
  lines.push("", "Findings");
  if (report.findings.length === 0)
    lines.push("  READY   No blockers found by supported checks");
  for (const finding of report.findings) {
    lines.push(`  ${finding.status.padEnd(8)} ${finding.title}`);
  }
  lines.push(
    "",
    "Limitations",
    ...report.limitations.map((limitation) => `  - ${limitation}`),
    "",
  );
  return `${lines.join("\n")}\n`;
}

function validateTimeout(value: string): void {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new PreflightError(
      "UNEXPECTED_ERROR",
      "Timeout must be a positive integer",
    );
  }
}

function statusColor(status: FindingStatus): (value: string) => string {
  switch (status) {
    case "BLOCKED":
      return pc.red;
    case "ACTION_REQUIRED":
      return pc.yellow;
    case "UNKNOWN":
      return pc.magenta;
    case "WARNING":
      return pc.yellow;
    case "READY":
      return pc.green;
  }
}
