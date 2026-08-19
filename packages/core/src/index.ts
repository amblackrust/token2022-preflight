export type Cluster = "mainnet-beta" | "devnet";
export type FindingStatus =
  | "BLOCKED"
  | "ACTION_REQUIRED"
  | "WARNING"
  | "READY"
  | "UNKNOWN";
export type TokenProgram = "legacy" | "token-2022" | "unsupported";

export interface Evidence {
  account: string;
  accountKind: "mint" | "source" | "destination" | "hook-meta";
  field: string;
  value: unknown;
}

export interface Finding {
  id: string;
  status: FindingStatus;
  category: string;
  title: string;
  summary: string;
  requiredActions: string[];
  evidence: Evidence[];
  docsUrl?: string;
  technicalDetails?: Record<string, unknown>;
}

export interface TransferFeeSchedule {
  epoch: bigint;
  basisPoints: number;
  maximumFeeRaw: bigint;
}

export interface HookResolution {
  status: "resolved" | "unresolved";
  accounts?: string[];
  reason?: string;
}

export interface NormalizedMintExtension {
  kind: string;
  typeId?: number;
  authority?: string | null;
  paused?: boolean;
  state?: "uninitialized" | "initialized" | "frozen";
  delegate?: string;
  programAddress?: string;
  resolution?: HookResolution;
  older?: TransferFeeSchedule;
  newer?: TransferFeeSchedule;
  configAuthority?: string | null;
  withdrawAuthority?: string | null;
}

export interface NormalizedAccountExtension {
  kind: "MemoTransfer" | "CpiGuard" | "ImmutableOwner" | string;
  requireIncomingTransferMemos?: boolean;
  enabled?: boolean;
}

export interface NormalizedTokenAccount {
  address: string;
  state: "uninitialized" | "initialized" | "frozen";
  extensions: NormalizedAccountExtension[];
}

export interface NormalizedMint {
  address: string;
  decimals: number;
  supplyRaw: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: NormalizedMintExtension[];
}

export interface NormalizedAnalysis {
  cluster: Cluster;
  mint: NormalizedMint;
  tokenProgram: TokenProgram;
  amountUi?: string;
  currentEpoch?: bigint;
  sourceTokenAccount?: NormalizedTokenAccount;
  destinationTokenAccount?: NormalizedTokenAccount;
}

export interface PreflightReport {
  schemaVersion: "1.0";
  engineVersion: string;
  generatedAt: string;
  cluster: Cluster;
  input: {
    mint: string;
    amountUi?: string;
    sourceTokenAccount?: string;
    destinationTokenAccount?: string;
  };
  tokenProgram: TokenProgram;
  mint: {
    address: string;
    decimals: number;
    supplyRaw: string;
    mintAuthority: string | null;
    freezeAuthority: string | null;
    extensions: string[];
  };
  transfer?: {
    amountRaw?: string;
    expectedFeeRaw?: string;
    expectedReceivedRaw?: string;
  };
  overallStatus: FindingStatus;
  findings: Finding[];
  limitations: string[];
}

const STATUS_PRIORITY: Readonly<Record<FindingStatus, number>> = {
  BLOCKED: 0,
  ACTION_REQUIRED: 1,
  UNKNOWN: 2,
  WARNING: 3,
  READY: 4,
};
const ENGINE_VERSION = "0.1.0";
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function parseUiAmount(amountUi: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Token decimals must be an integer between 0 and 255");
  }
  if (!AMOUNT_PATTERN.test(amountUi)) {
    throw new Error("Amount must be a non-negative decimal string");
  }
  const [whole = "0", fraction = ""] = amountUi.split(".");
  if (fraction.length > decimals)
    throw new Error(`Amount has more than ${decimals} decimal places`);
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")
  );
}

export function analyzeNormalizedToken(
  analysis: NormalizedAnalysis,
): PreflightReport {
  const findings = [
    ...buildMintFindings(analysis),
    ...buildAccountFindings(analysis.sourceTokenAccount, "source"),
    ...buildAccountFindings(analysis.destinationTokenAccount, "destination"),
  ].sort(compareFindings);
  const transfer = buildTransferSummary(analysis);
  return {
    schemaVersion: "1.0",
    engineVersion: ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    cluster: analysis.cluster,
    input: {
      mint: analysis.mint.address,
      ...(analysis.amountUi === undefined
        ? {}
        : { amountUi: analysis.amountUi }),
      ...(analysis.sourceTokenAccount === undefined
        ? {}
        : { sourceTokenAccount: analysis.sourceTokenAccount.address }),
      ...(analysis.destinationTokenAccount === undefined
        ? {}
        : {
            destinationTokenAccount: analysis.destinationTokenAccount.address,
          }),
    },
    tokenProgram: analysis.tokenProgram,
    mint: {
      address: analysis.mint.address,
      decimals: analysis.mint.decimals,
      supplyRaw: analysis.mint.supplyRaw.toString(),
      mintAuthority: analysis.mint.mintAuthority,
      freezeAuthority: analysis.mint.freezeAuthority,
      extensions: analysis.mint.extensions.map(({ kind }) => kind).sort(),
    },
    ...(transfer === undefined ? {} : { transfer }),
    overallStatus: findings[0]?.status ?? "READY",
    findings,
    limitations: [
      "No transaction simulation is performed; supported checks are not a transfer guarantee.",
    ],
  };
}

function buildMintFindings(analysis: NormalizedAnalysis): Finding[] {
  const findings = analysis.mint.extensions.flatMap((extension) =>
    mintExtensionFindings(analysis, extension),
  );
  if (analysis.mint.freezeAuthority !== null) {
    findings.push(
      makeFinding(
        "freeze-authority",
        "WARNING",
        "authority",
        "Freeze authority is active",
        "The authority can freeze token accounts, but this does not prove an account is frozen.",
        [
          "Check source and destination account state for the transfer scenario.",
        ],
        mintEvidence(
          analysis.mint.address,
          "freezeAuthority",
          analysis.mint.freezeAuthority,
        ),
      ),
    );
  }
  return findings;
}

function mintExtensionFindings(
  analysis: NormalizedAnalysis,
  extension: NormalizedMintExtension,
): Finding[] {
  const mint = analysis.mint.address;
  switch (extension.kind) {
    case "NonTransferable":
      return [
        makeFinding(
          "non-transferable",
          "BLOCKED",
          "transfer",
          "Mint is non-transferable",
          "Token-2022 enforces this restriction on-chain for ordinary transfers.",
          [],
          mintEvidence(mint, "extensions.NonTransferable", true),
        ),
      ];
    case "PausableConfig":
      return [
        makeFinding(
          extension.paused ? "mint-paused" : "mint-pausable",
          extension.paused ? "BLOCKED" : "WARNING",
          "transfer",
          extension.paused ? "Mint transfers are paused" : "Mint can be paused",
          extension.paused
            ? "Token-2022 currently rejects transfers for this mint."
            : "The pause authority can pause transfers later.",
          [],
          mintEvidence(mint, "extensions.PausableConfig", {
            paused: extension.paused,
            authority: extension.authority,
          }),
        ),
      ];
    case "DefaultAccountState":
      return extension.state === "frozen"
        ? [
            makeFinding(
              "default-account-state-frozen",
              "WARNING",
              "account",
              "New token accounts default to frozen",
              "Existing account state must be checked separately.",
              ["Check both token accounts in a transfer scenario."],
              mintEvidence(
                mint,
                "extensions.DefaultAccountState.state",
                "frozen",
              ),
            ),
          ]
        : [];
    case "TransferFeeConfig":
      return [transferFeeFinding(analysis, extension)];
    case "TransferHook": {
      const findings = [
        makeFinding(
          "transfer-hook",
          "ACTION_REQUIRED",
          "transfer",
          "Transfer Hook requires additional processing",
          "The transfer must invoke the configured hook with its required accounts.",
          ["Resolve and include the hook ExtraAccountMetaList accounts."],
          mintEvidence(
            mint,
            "extensions.TransferHook.programAddress",
            extension.programAddress,
          ),
        ),
      ];
      if (extension.resolution?.status === "unresolved") {
        findings.push(
          makeFinding(
            "transfer-hook-unresolved",
            "UNKNOWN",
            "transfer",
            "Transfer Hook accounts unresolved",
            extension.resolution.reason ??
              "Additional accounts could not be resolved.",
            ["Resolve the hook accounts before building a transaction."],
            mintEvidence(
              mint,
              "extensions.TransferHook.resolution",
              "unresolved",
            ),
          ),
        );
      }
      return findings;
    }
    case "PermanentDelegate":
      return [
        makeFinding(
          "permanent-delegate",
          "WARNING",
          "authority",
          "Permanent delegate is active",
          "The delegate can transfer or burn tokens from any account for this mint.",
          [],
          mintEvidence(
            mint,
            "extensions.PermanentDelegate.delegate",
            extension.delegate,
          ),
        ),
      ];
    case "InterestBearingConfig":
    case "ScaledUiAmount":
      return [
        makeFinding(
          `ui-amount-${extension.kind}`,
          "WARNING",
          "amount",
          "UI amount has additional rules",
          `${extension.kind} affects display and conversion of UI amounts.`,
          ["Use official conversion helpers."],
          mintEvidence(mint, `extensions.${extension.kind}`, true),
        ),
      ];
    case "ConfidentialTransferMint":
    case "ConfidentialTransferFeeConfig":
      return [
        makeFinding(
          `unsupported-${extension.kind}`,
          "UNKNOWN",
          "transfer",
          "Confidential flow is unsupported",
          "This version detects the extension but does not analyze confidential transfers.",
          ["Review confidential transfer requirements separately."],
          mintEvidence(mint, `extensions.${extension.kind}`, true),
        ),
      ];
    default:
      return [
        makeFinding(
          `unknown-extension-${extension.kind}`,
          "UNKNOWN",
          "extension",
          `Unsupported extension: ${extension.kind}`,
          "This version cannot determine how the extension affects the transfer.",
          ["Review the extension before integrating this token."],
          mintEvidence(
            mint,
            `extensions.${extension.kind}`,
            extension.typeId ?? true,
          ),
        ),
      ];
  }
}

function transferFeeFinding(
  analysis: NormalizedAnalysis,
  extension: NormalizedMintExtension,
): Finding {
  const schedule = selectFeeSchedule(extension, analysis.currentEpoch);
  const technicalDetails: Record<string, unknown> = {
    configAuthority: extension.configAuthority ?? null,
    withdrawAuthority: extension.withdrawAuthority ?? null,
  };
  if (schedule !== undefined) {
    technicalDetails.basisPoints = schedule.basisPoints;
    technicalDetails.maximumFeeRaw = schedule.maximumFeeRaw.toString();
  }
  return {
    ...makeFinding(
      "transfer-fee",
      "ACTION_REQUIRED",
      "fee",
      "Token charges a transfer fee",
      analysis.amountUi === undefined
        ? "Provide an amount to calculate the expected fee."
        : "The received amount is lower than the sent amount.",
      ["Include the expected fee in transfer handling."],
      mintEvidence(analysis.mint.address, "extensions.TransferFeeConfig", true),
    ),
    technicalDetails,
  };
}

function buildTransferSummary(
  analysis: NormalizedAnalysis,
): PreflightReport["transfer"] | undefined {
  if (analysis.amountUi === undefined) return undefined;
  const amountRaw = parseUiAmount(analysis.amountUi, analysis.mint.decimals);
  const feeExtension = analysis.mint.extensions.find(
    ({ kind }) => kind === "TransferFeeConfig",
  );
  const schedule =
    feeExtension === undefined
      ? undefined
      : selectFeeSchedule(feeExtension, analysis.currentEpoch);
  if (schedule === undefined) return { amountRaw: amountRaw.toString() };
  const calculatedFee =
    (amountRaw * BigInt(schedule.basisPoints) + 9_999n) / 10_000n;
  const fee =
    calculatedFee > schedule.maximumFeeRaw
      ? schedule.maximumFeeRaw
      : calculatedFee;
  return {
    amountRaw: amountRaw.toString(),
    expectedFeeRaw: fee.toString(),
    expectedReceivedRaw: (amountRaw - fee).toString(),
  };
}

function selectFeeSchedule(
  extension: NormalizedMintExtension,
  currentEpoch?: bigint,
): TransferFeeSchedule | undefined {
  if (extension.older === undefined || extension.newer === undefined)
    return undefined;
  return currentEpoch !== undefined && currentEpoch >= extension.newer.epoch
    ? extension.newer
    : extension.older;
}

function buildAccountFindings(
  account: NormalizedTokenAccount | undefined,
  role: "source" | "destination",
): Finding[] {
  if (account === undefined) return [];
  const findings: Finding[] = [];
  if (account.state === "frozen") {
    findings.push(
      makeFinding(
        `${role}-frozen`,
        "BLOCKED",
        "account",
        `${capitalize(role)} account is frozen`,
        "Token-2022 rejects ordinary transfers involving a frozen account.",
        [],
        [
          {
            account: account.address,
            accountKind: role,
            field: "state",
            value: "frozen",
          },
        ],
      ),
    );
  }
  for (const extension of account.extensions) {
    if (
      role === "destination" &&
      extension.kind === "MemoTransfer" &&
      extension.requireIncomingTransferMemos
    ) {
      findings.push(
        makeFinding(
          "destination-memo-required",
          "ACTION_REQUIRED",
          "account",
          "Destination requires a memo",
          "A Memo instruction must immediately precede the transfer.",
          ["Add a Memo instruction immediately before transfer."],
          [
            {
              account: account.address,
              accountKind: role,
              field: "extensions.MemoTransfer.requireIncomingTransferMemos",
              value: true,
            },
          ],
        ),
      );
    } else if (
      extension.kind === "CpiGuard" ||
      extension.kind === "ImmutableOwner"
    ) {
      findings.push(
        makeFinding(
          `${role}-${extension.kind}`,
          "READY",
          "account",
          `${extension.kind} detected`,
          "This extension alone does not block an ordinary owner-signed transfer.",
          [],
          [
            {
              account: account.address,
              accountKind: role,
              field: `extensions.${extension.kind}`,
              value: extension.enabled ?? true,
            },
          ],
        ),
      );
    }
  }
  return findings;
}

function makeFinding(
  id: string,
  status: FindingStatus,
  category: string,
  title: string,
  summary: string,
  requiredActions: string[],
  evidence: Evidence[],
): Finding {
  return { id, status, category, title, summary, requiredActions, evidence };
}

function mintEvidence(
  account: string,
  field: string,
  value: unknown,
): Evidence[] {
  return [{ account, accountKind: "mint", field, value }];
}

function compareFindings(left: Finding, right: Finding): number {
  return (
    STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status] ||
    left.id.localeCompare(right.id)
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
