import {
  address,
  createSolanaRpc,
  devnet,
  mainnet,
  unwrapOption,
  type Address,
  type ReadonlyUint8Array,
} from "@solana/kit";
import {
  AccountState,
  getMintDecoder,
  getTokenDecoder,
  resolveExtraAccountMetasForExecute,
  TOKEN_2022_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  type Extension,
} from "@solana-program/token-2022";
import {
  analyzeNormalizedToken,
  parseUiAmount,
  type Cluster,
  type NormalizedAccountExtension,
  type NormalizedAnalysis,
  type NormalizedMint,
  type NormalizedMintExtension,
  type NormalizedTokenAccount,
  type PreflightReport,
  type TokenProgram,
} from "@token2022-preflight/core";

export type PreflightErrorCode =
  | "INVALID_ADDRESS"
  | "INVALID_AMOUNT"
  | "ACCOUNT_NOT_FOUND"
  | "UNSUPPORTED_OWNER"
  | "MINT_DECODE_FAILED"
  | "TOKEN_ACCOUNT_DECODE_FAILED"
  | "MINT_MISMATCH"
  | "RPC_RATE_LIMITED"
  | "RPC_TIMEOUT"
  | "RPC_UNAVAILABLE"
  | "HOOK_ACCOUNTS_UNRESOLVED"
  | "UNEXPECTED_ERROR";

const ZERO_ADDRESS = "11111111111111111111111111111111";

export class PreflightError extends Error {
  public constructor(
    public readonly code: PreflightErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PreflightError";
  }
}

export interface RawAccount {
  owner: Address;
  data: ReadonlyUint8Array;
}

export interface AccountReader {
  getAccount(accountAddress: Address): Promise<RawAccount | null>;
  getEpoch(): Promise<bigint>;
  resolveTransferHook?(input: TransferHookResolutionInput): Promise<string[]>;
}

export interface TransferHookResolutionInput {
  programAddress: Address;
  source: Address;
  mint: Address;
  destination: Address;
  owner: Address;
  amountRaw: bigint;
}

export interface AnalyzeTokenTransferInput {
  rpcUrl: string;
  cluster: Cluster;
  mint: string;
  amountUi?: string;
  sourceTokenAccount?: string;
  destinationTokenAccount?: string;
  timeoutMs?: number;
}

export interface AnalyzeDependencies {
  reader?: AccountReader;
}

export async function analyzeTokenTransfer(
  input: AnalyzeTokenTransferInput,
  dependencies: AnalyzeDependencies = {},
): Promise<PreflightReport> {
  if (
    (input.sourceTokenAccount === undefined) !==
    (input.destinationTokenAccount === undefined)
  ) {
    throw new PreflightError(
      "INVALID_ADDRESS",
      "Source and destination token accounts must be provided together",
    );
  }

  let mintAddress: Address;
  try {
    mintAddress = address(input.mint.trim());
  } catch (cause) {
    throw new PreflightError(
      "INVALID_ADDRESS",
      "Mint must be a valid Solana address",
      { cause },
    );
  }

  const reader =
    dependencies.reader ??
    createAccountReader(input.rpcUrl, input.cluster, input.timeoutMs ?? 10_000);
  const account = await reader.getAccount(mintAddress);
  if (account === null) {
    throw new PreflightError("ACCOUNT_NOT_FOUND", "Mint account was not found");
  }
  let tokenProgram: TokenProgram;
  try {
    tokenProgram = detectTokenProgram(account.owner);
  } catch (error) {
    if (error instanceof PreflightError && error.code === "UNSUPPORTED_OWNER") {
      return partialReport(
        input,
        "unsupported",
        "BLOCKED",
        "unsupported-owner",
        "Mint owner is unsupported",
        error.message,
        [
          {
            account: mintAddress,
            accountKind: "mint",
            field: "owner",
            value: account.owner,
          },
        ],
      );
    }
    throw error;
  }
  let mint: NormalizedMint;
  try {
    mint = decodeMintData(mintAddress, account.data);
  } catch (error) {
    if (
      error instanceof PreflightError &&
      error.code === "MINT_DECODE_FAILED"
    ) {
      return partialReport(
        input,
        tokenProgram,
        "UNKNOWN",
        "mint-decode-failed",
        "Mint data could not be decoded",
        error.message,
        [],
      );
    }
    throw error;
  }
  const tokenAccounts = await fetchTransferAccounts(
    input,
    reader,
    mintAddress,
    account.owner,
  );
  if (input.amountUi !== undefined) {
    try {
      parseUiAmount(input.amountUi.trim(), mint.decimals);
    } catch (cause) {
      throw new PreflightError(
        "INVALID_AMOUNT",
        cause instanceof Error ? cause.message : "Amount is invalid",
        { cause },
      );
    }
  }
  const currentEpoch = mint.extensions.some(
    ({ kind }) => kind === "TransferFeeConfig",
  )
    ? await reader.getEpoch()
    : undefined;
  await resolveTransferHook(mint, tokenAccounts, input, reader, mintAddress);

  return analyzeNormalizedToken({
    cluster: input.cluster,
    tokenProgram,
    mint,
    ...(input.amountUi === undefined
      ? {}
      : { amountUi: input.amountUi.trim() }),
    ...(currentEpoch === undefined ? {} : { currentEpoch }),
    ...tokenAccounts,
  });
}

function partialReport(
  input: AnalyzeTokenTransferInput,
  tokenProgram: TokenProgram,
  status: "BLOCKED" | "UNKNOWN",
  findingId: string,
  title: string,
  summary: string,
  evidence: PreflightReport["findings"][number]["evidence"],
): PreflightReport {
  return {
    schemaVersion: "1.0",
    engineVersion: "0.1.0",
    generatedAt: new Date().toISOString(),
    cluster: input.cluster,
    input: {
      mint: input.mint.trim(),
      ...(input.amountUi === undefined ? {} : { amountUi: input.amountUi }),
      ...(input.sourceTokenAccount === undefined
        ? {}
        : { sourceTokenAccount: input.sourceTokenAccount }),
      ...(input.destinationTokenAccount === undefined
        ? {}
        : { destinationTokenAccount: input.destinationTokenAccount }),
    },
    tokenProgram,
    mint: { address: input.mint.trim(), extensions: [] },
    overallStatus: status,
    findings: [
      {
        id: findingId,
        status,
        category: "program",
        title,
        summary,
        requiredActions: [],
        evidence,
      },
    ],
    limitations: [
      "Analysis stopped before extension checks because the mint could not be decoded safely.",
    ],
  };
}

async function fetchTransferAccounts(
  input: AnalyzeTokenTransferInput,
  reader: AccountReader,
  mintAddress: Address,
  expectedOwner: Address,
): Promise<
  Pick<NormalizedAnalysis, "sourceTokenAccount" | "destinationTokenAccount">
> {
  if (
    input.sourceTokenAccount === undefined ||
    input.destinationTokenAccount === undefined
  )
    return {};
  const sourceAddress = parseAddress(
    input.sourceTokenAccount,
    "Source token account",
  );
  const destinationAddress = parseAddress(
    input.destinationTokenAccount,
    "Destination token account",
  );
  const [source, destination] = await Promise.all([
    reader.getAccount(sourceAddress),
    reader.getAccount(destinationAddress),
  ]);
  if (source === null || destination === null) {
    throw new PreflightError(
      "ACCOUNT_NOT_FOUND",
      "Source or destination token account was not found",
    );
  }
  if (source.owner !== expectedOwner || destination.owner !== expectedOwner) {
    throw new PreflightError(
      "UNSUPPORTED_OWNER",
      "Token account owner program does not match the mint program",
    );
  }
  return {
    sourceTokenAccount: decodeTokenData(
      sourceAddress,
      source.data,
      mintAddress,
    ),
    destinationTokenAccount: decodeTokenData(
      destinationAddress,
      destination.data,
      mintAddress,
    ),
  };
}

function parseAddress(value: string, label: string): Address {
  try {
    return address(value.trim());
  } catch (cause) {
    throw new PreflightError(
      "INVALID_ADDRESS",
      `${label} must be a valid Solana address`,
      { cause },
    );
  }
}

export function createAccountReader(
  rpcUrl: string,
  cluster: Cluster,
  timeoutMs = 10_000,
): AccountReader {
  const clusterUrl = cluster === "devnet" ? devnet(rpcUrl) : mainnet(rpcUrl);
  const rpc = createSolanaRpc(clusterUrl);
  return {
    async getAccount(accountAddress) {
      try {
        const { value } = await rpc
          .getAccountInfo(accountAddress, { encoding: "base64" })
          .send({ abortSignal: AbortSignal.timeout(timeoutMs) });
        if (value === null) return null;
        return {
          owner: value.owner,
          data: Uint8Array.from(Buffer.from(value.data[0], "base64")),
        };
      } catch (cause) {
        throw mapRpcError(cause);
      }
    },
    async getEpoch() {
      try {
        return (
          await rpc
            .getEpochInfo()
            .send({ abortSignal: AbortSignal.timeout(timeoutMs) })
        ).epoch;
      } catch (cause) {
        throw mapRpcError(cause);
      }
    },
    async resolveTransferHook(input) {
      try {
        const metas = await resolveExtraAccountMetasForExecute({
          rpc,
          transferHookProgramAddress: input.programAddress,
          source: input.source,
          mint: input.mint,
          destination: input.destination,
          owner: input.owner,
          amount: input.amountRaw,
        });
        return metas.map(({ address }) => address);
      } catch (cause) {
        throw mapRpcError(cause);
      }
    },
  };
}

function mapRpcError(cause: unknown): PreflightError {
  const message = cause instanceof Error ? cause.message : "Unknown RPC error";
  if (
    (cause instanceof Error && cause.name === "TimeoutError") ||
    /timed?\s*out|abort/i.test(message)
  ) {
    return new PreflightError("RPC_TIMEOUT", "Solana RPC request timed out", {
      cause,
    });
  }
  if (/429|rate.?limit/i.test(message)) {
    return new PreflightError(
      "RPC_RATE_LIMITED",
      "Solana RPC rate limit exceeded",
      { cause },
    );
  }
  return new PreflightError("RPC_UNAVAILABLE", "Solana RPC request failed", {
    cause,
  });
}

export function detectTokenProgram(owner: Address): TokenProgram {
  if (owner === TOKEN_PROGRAM_ADDRESS) return "legacy";
  if (owner === TOKEN_2022_PROGRAM_ADDRESS) return "token-2022";
  throw new PreflightError(
    "UNSUPPORTED_OWNER",
    "Mint account is not owned by a supported token program",
  );
}

export function decodeMintData(
  address: Address,
  data: ReadonlyUint8Array,
): NormalizedMint {
  try {
    const mint = getMintDecoder().decode(data);
    return {
      address,
      decimals: mint.decimals,
      supplyRaw: mint.supply,
      mintAuthority: optionAddress(mint.mintAuthority),
      freezeAuthority: optionAddress(mint.freezeAuthority),
      extensions: (unwrapOption(mint.extensions) ?? []).map(
        normalizeMintExtension,
      ),
    };
  } catch (cause) {
    throw new PreflightError(
      "MINT_DECODE_FAILED",
      "Unable to decode the mint account",
      { cause },
    );
  }
}

export function decodeTokenData(
  accountAddress: Address,
  data: ReadonlyUint8Array,
  expectedMint: Address,
): NormalizedTokenAccount {
  let token: ReturnType<ReturnType<typeof getTokenDecoder>["decode"]>;
  try {
    token = getTokenDecoder().decode(data);
  } catch (cause) {
    throw new PreflightError(
      "TOKEN_ACCOUNT_DECODE_FAILED",
      "Unable to decode the token account",
      { cause },
    );
  }
  if (token.mint !== expectedMint) {
    throw new PreflightError(
      "MINT_MISMATCH",
      "Token account belongs to a different mint",
    );
  }
  return {
    address: accountAddress,
    owner: token.owner,
    balanceRaw: token.amount,
    state: accountState(token.state),
    extensions: (unwrapOption(token.extensions) ?? []).flatMap(
      (extension): NormalizedAccountExtension[] => {
        switch (extension.__kind) {
          case "MemoTransfer":
            return [
              {
                kind: extension.__kind,
                requireIncomingTransferMemos:
                  extension.requireIncomingTransferMemos,
              },
            ];
          case "CpiGuard":
            return [{ kind: extension.__kind, enabled: extension.lockCpi }];
          case "ImmutableOwner":
            return [{ kind: extension.__kind, enabled: true }];
          default:
            return [{ kind: extension.__kind }];
        }
      },
    ),
  };
}

async function resolveTransferHook(
  mint: NormalizedMint,
  tokenAccounts: Pick<
    NormalizedAnalysis,
    "sourceTokenAccount" | "destinationTokenAccount"
  >,
  input: AnalyzeTokenTransferInput,
  reader: AccountReader,
  mintAddress: Address,
): Promise<void> {
  const extension = mint.extensions.find(({ kind }) => kind === "TransferHook");
  if (extension === undefined) return;
  const source = tokenAccounts.sourceTokenAccount;
  const destination = tokenAccounts.destinationTokenAccount;
  if (
    input.amountUi === undefined ||
    source === undefined ||
    destination === undefined ||
    source.owner === undefined ||
    extension.programAddress === undefined ||
    reader.resolveTransferHook === undefined
  ) {
    extension.resolution = {
      status: "unresolved",
      reason:
        "Amount and both token accounts are required to resolve Transfer Hook accounts",
    };
    return;
  }
  try {
    extension.resolution = {
      status: "resolved",
      accounts: await reader.resolveTransferHook({
        programAddress: address(extension.programAddress),
        source: address(source.address),
        mint: mintAddress,
        destination: address(destination.address),
        owner: address(source.owner),
        amountRaw: parseUiAmount(input.amountUi.trim(), mint.decimals),
      }),
    };
  } catch (error) {
    extension.resolution = {
      status: "unresolved",
      reason:
        error instanceof Error
          ? error.message
          : "Transfer Hook accounts could not be resolved",
    };
  }
}

function optionAddress(
  value: Parameters<typeof unwrapOption<Address>>[0],
): string | null {
  return unwrapOption(value);
}

function normalizeMintExtension(extension: Extension): NormalizedMintExtension {
  switch (extension.__kind) {
    case "NonTransferable":
      return { kind: extension.__kind };
    case "PermanentDelegate":
      return { kind: extension.__kind, delegate: extension.delegate };
    case "PausableConfig":
      return {
        kind: extension.__kind,
        authority: optionAddress(extension.authority),
        paused: extension.paused,
      };
    case "DefaultAccountState":
      return { kind: extension.__kind, state: accountState(extension.state) };
    case "TransferFeeConfig":
      return {
        kind: extension.__kind,
        configAuthority: nullableNonZeroAddress(
          extension.transferFeeConfigAuthority,
        ),
        withdrawAuthority: nullableNonZeroAddress(
          extension.withdrawWithheldAuthority,
        ),
        older: {
          epoch: extension.olderTransferFee.epoch,
          basisPoints: extension.olderTransferFee.transferFeeBasisPoints,
          maximumFeeRaw: extension.olderTransferFee.maximumFee,
        },
        newer: {
          epoch: extension.newerTransferFee.epoch,
          basisPoints: extension.newerTransferFee.transferFeeBasisPoints,
          maximumFeeRaw: extension.newerTransferFee.maximumFee,
        },
      };
    case "TransferHook":
      return {
        kind: extension.__kind,
        authority: extension.authority,
        programAddress: extension.programId,
      };
    case "InterestBearingConfig":
    case "ScaledUiAmountConfig":
      return {
        kind:
          extension.__kind === "ScaledUiAmountConfig"
            ? "ScaledUiAmount"
            : extension.__kind,
      };
    case "ConfidentialTransferMint":
    case "ConfidentialTransferFee":
    case "ConfidentialMintBurn":
      return { kind: extension.__kind };
    default:
      return { kind: extension.__kind };
  }
}

function nullableNonZeroAddress(value: Address): string | null {
  return value === ZERO_ADDRESS ? null : value;
}

function accountState(
  state: AccountState,
): "uninitialized" | "initialized" | "frozen" {
  switch (state) {
    case AccountState.Uninitialized:
      return "uninitialized";
    case AccountState.Initialized:
      return "initialized";
    case AccountState.Frozen:
      return "frozen";
  }
}
