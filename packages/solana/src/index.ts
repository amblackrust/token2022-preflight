import {
  address,
  createSolanaRpc,
  devnet,
  mainnet,
  unwrapOption,
  type Address,
  type ReadonlyUint8Array,
} from '@solana/kit';
import {
  AccountState,
  getMintDecoder,
  getTokenDecoder,
  TOKEN_2022_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  type Extension,
} from '@solana-program/token-2022';
import {
  analyzeNormalizedToken,
  type Cluster,
  type NormalizedAccountExtension,
  type NormalizedMint,
  type NormalizedMintExtension,
  type NormalizedTokenAccount,
  type PreflightReport,
  type TokenProgram,
} from '@token2022-preflight/core';

export type PreflightErrorCode =
  | 'INVALID_ADDRESS'
  | 'ACCOUNT_NOT_FOUND'
  | 'UNSUPPORTED_OWNER'
  | 'MINT_DECODE_FAILED'
  | 'TOKEN_ACCOUNT_DECODE_FAILED'
  | 'MINT_MISMATCH'
  | 'RPC_RATE_LIMITED'
  | 'RPC_TIMEOUT'
  | 'RPC_UNAVAILABLE'
  | 'HOOK_ACCOUNTS_UNRESOLVED'
  | 'UNEXPECTED_ERROR';

export class PreflightError extends Error {
  public constructor(
    public readonly code: PreflightErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PreflightError';
  }
}

export interface RawAccount {
  owner: Address;
  data: ReadonlyUint8Array;
}

export interface AccountReader {
  getAccount(accountAddress: Address): Promise<RawAccount | null>;
  getEpoch(): Promise<bigint>;
}

export interface AnalyzeTokenTransferInput {
  rpcUrl: string;
  cluster: Cluster;
  mint: string;
  amountUi?: string;
  sourceTokenAccount?: string;
  destinationTokenAccount?: string;
}

export interface AnalyzeDependencies {
  reader?: AccountReader;
}

export async function analyzeTokenTransfer(
  input: AnalyzeTokenTransferInput,
  dependencies: AnalyzeDependencies = {},
): Promise<PreflightReport> {
  if ((input.sourceTokenAccount === undefined) !== (input.destinationTokenAccount === undefined)) {
    throw new PreflightError('INVALID_ADDRESS', 'Source and destination token accounts must be provided together');
  }

  let mintAddress: Address;
  try {
    mintAddress = address(input.mint.trim());
  } catch (cause) {
    throw new PreflightError('INVALID_ADDRESS', 'Mint must be a valid Solana address', { cause });
  }

  const reader = dependencies.reader ?? createAccountReader(input.rpcUrl, input.cluster);
  const account = await reader.getAccount(mintAddress);
  if (account === null) {
    throw new PreflightError('ACCOUNT_NOT_FOUND', 'Mint account was not found');
  }
  const tokenProgram = detectTokenProgram(account.owner);
  const mint = decodeMintData(mintAddress, account.data);
  const tokenAccounts = await fetchTransferAccounts(input, reader, mintAddress, account.owner);
  const currentEpoch = mint.extensions.some(({ kind }) => kind === 'TransferFeeConfig')
    ? await reader.getEpoch()
    : undefined;

  return analyzeNormalizedToken({
    cluster: input.cluster,
    tokenProgram,
    mint,
    ...(input.amountUi === undefined ? {} : { amountUi: input.amountUi.trim() }),
    ...(currentEpoch === undefined ? {} : { currentEpoch }),
    ...tokenAccounts,
  });
}

async function fetchTransferAccounts(
  input: AnalyzeTokenTransferInput,
  reader: AccountReader,
  mintAddress: Address,
  expectedOwner: Address,
): Promise<Pick<import('@token2022-preflight/core').NormalizedAnalysis, 'sourceTokenAccount' | 'destinationTokenAccount'>> {
  if (input.sourceTokenAccount === undefined || input.destinationTokenAccount === undefined) return {};
  const sourceAddress = parseAddress(input.sourceTokenAccount, 'Source token account');
  const destinationAddress = parseAddress(input.destinationTokenAccount, 'Destination token account');
  const [source, destination] = await Promise.all([
    reader.getAccount(sourceAddress),
    reader.getAccount(destinationAddress),
  ]);
  if (source === null || destination === null) {
    throw new PreflightError('ACCOUNT_NOT_FOUND', 'Source or destination token account was not found');
  }
  if (source.owner !== expectedOwner || destination.owner !== expectedOwner) {
    throw new PreflightError('UNSUPPORTED_OWNER', 'Token account owner program does not match the mint program');
  }
  return {
    sourceTokenAccount: decodeTokenData(sourceAddress, source.data, mintAddress),
    destinationTokenAccount: decodeTokenData(destinationAddress, destination.data, mintAddress),
  };
}

function parseAddress(value: string, label: string): Address {
  try {
    return address(value.trim());
  } catch (cause) {
    throw new PreflightError('INVALID_ADDRESS', `${label} must be a valid Solana address`, { cause });
  }
}

export function createAccountReader(rpcUrl: string, cluster: Cluster): AccountReader {
  const clusterUrl = cluster === 'devnet' ? devnet(rpcUrl) : mainnet(rpcUrl);
  const rpc = createSolanaRpc(clusterUrl);
  return {
    async getAccount(accountAddress) {
      try {
        const { value } = await rpc.getAccountInfo(accountAddress, { encoding: 'base64' }).send();
        if (value === null) return null;
        return {
          owner: value.owner,
          data: Uint8Array.from(Buffer.from(value.data[0], 'base64')),
        };
      } catch (cause) {
        throw mapRpcError(cause);
      }
    },
    async getEpoch() {
      try {
        return (await rpc.getEpochInfo().send()).epoch;
      } catch (cause) {
        throw mapRpcError(cause);
      }
    },
  };
}

function mapRpcError(cause: unknown): PreflightError {
  const message = cause instanceof Error ? cause.message : 'Unknown RPC error';
  if (/429|rate.?limit/i.test(message)) {
    return new PreflightError('RPC_RATE_LIMITED', 'Solana RPC rate limit exceeded', { cause });
  }
  return new PreflightError('RPC_UNAVAILABLE', 'Solana RPC request failed', { cause });
}

export function detectTokenProgram(owner: Address): TokenProgram {
  if (owner === TOKEN_PROGRAM_ADDRESS) return 'legacy';
  if (owner === TOKEN_2022_PROGRAM_ADDRESS) return 'token-2022';
  throw new PreflightError('UNSUPPORTED_OWNER', 'Mint account is not owned by a supported token program');
}

export function decodeMintData(address: Address, data: ReadonlyUint8Array): NormalizedMint {
  try {
    const mint = getMintDecoder().decode(data);
    return {
      address,
      decimals: mint.decimals,
      supplyRaw: mint.supply,
      mintAuthority: optionAddress(mint.mintAuthority),
      freezeAuthority: optionAddress(mint.freezeAuthority),
      extensions: (unwrapOption(mint.extensions) ?? []).map(normalizeMintExtension),
    };
  } catch (cause) {
    throw new PreflightError('MINT_DECODE_FAILED', 'Unable to decode the mint account', { cause });
  }
}

export function decodeTokenData(
  accountAddress: Address,
  data: ReadonlyUint8Array,
  expectedMint: Address,
): NormalizedTokenAccount {
  let token: ReturnType<ReturnType<typeof getTokenDecoder>['decode']>;
  try {
    token = getTokenDecoder().decode(data);
  } catch (cause) {
    throw new PreflightError('TOKEN_ACCOUNT_DECODE_FAILED', 'Unable to decode the token account', { cause });
  }
  if (token.mint !== expectedMint) {
    throw new PreflightError('MINT_MISMATCH', 'Token account belongs to a different mint');
  }
  return {
    address: accountAddress,
    state: accountState(token.state),
    extensions: (unwrapOption(token.extensions) ?? []).flatMap((extension): NormalizedAccountExtension[] => {
      switch (extension.__kind) {
        case 'MemoTransfer':
          return [{ kind: extension.__kind, requireIncomingTransferMemos: extension.requireIncomingTransferMemos }];
        case 'CpiGuard':
          return [{ kind: extension.__kind, enabled: extension.lockCpi }];
        case 'ImmutableOwner':
          return [{ kind: extension.__kind, enabled: true }];
        default:
          return [];
      }
    }),
  };
}

function optionAddress(value: Parameters<typeof unwrapOption<Address>>[0]): string | null {
  return unwrapOption(value);
}

function normalizeMintExtension(extension: Extension): NormalizedMintExtension {
  switch (extension.__kind) {
    case 'NonTransferable':
      return { kind: extension.__kind };
    case 'PermanentDelegate':
      return { kind: extension.__kind, delegate: extension.delegate };
    case 'PausableConfig':
      return { kind: extension.__kind, authority: optionAddress(extension.authority), paused: extension.paused };
    case 'DefaultAccountState':
      return { kind: extension.__kind, state: accountState(extension.state) };
    case 'TransferFeeConfig':
      return {
        kind: extension.__kind,
        configAuthority: extension.transferFeeConfigAuthority,
        withdrawAuthority: extension.withdrawWithheldAuthority,
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
    case 'TransferHook':
      return { kind: extension.__kind, authority: extension.authority, programAddress: extension.programId };
    case 'InterestBearingConfig':
    case 'ScaledUiAmountConfig':
      return { kind: extension.__kind === 'ScaledUiAmountConfig' ? 'ScaledUiAmount' : extension.__kind };
    case 'ConfidentialTransferMint':
    case 'ConfidentialTransferFee':
    case 'ConfidentialMintBurn':
      return { kind: extension.__kind };
    default:
      return { kind: extension.__kind };
  }
}

function accountState(state: AccountState): 'uninitialized' | 'initialized' | 'frozen' {
  switch (state) {
    case AccountState.Uninitialized:
      return 'uninitialized';
    case AccountState.Initialized:
      return 'initialized';
    case AccountState.Frozen:
      return 'frozen';
  }
}
