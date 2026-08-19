export type Cluster = 'mainnet-beta' | 'devnet';
export type FindingStatus = 'BLOCKED' | 'ACTION_REQUIRED' | 'WARNING' | 'READY' | 'UNKNOWN';
export type TokenProgram = 'legacy' | 'token-2022' | 'unsupported';

export interface Evidence {
  account: string;
  accountKind: 'mint' | 'source' | 'destination' | 'hook-meta';
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

export type NormalizedMintExtension =
  | { kind: 'NonTransferable' }
  | { kind: 'TransferHook'; programAddress: string }
  | { kind: string; typeId: number };

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
}

export interface PreflightReport {
  schemaVersion: '1.0';
  engineVersion: string;
  generatedAt: string;
  cluster: Cluster;
  input: { mint: string };
  tokenProgram: TokenProgram;
  mint: {
    address: string;
    decimals: number;
    supplyRaw: string;
    mintAuthority: string | null;
    freezeAuthority: string | null;
    extensions: string[];
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

const ENGINE_VERSION = '0.1.0';
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function parseUiAmount(amountUi: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error('Token decimals must be an integer between 0 and 255');
  }
  if (!AMOUNT_PATTERN.test(amountUi)) {
    throw new Error('Amount must be a non-negative decimal string');
  }

  const [whole = '0', fraction = ''] = amountUi.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimal places`);
  }

  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

export function analyzeNormalizedToken(analysis: NormalizedAnalysis): PreflightReport {
  const findings = buildFindings(analysis.mint).sort(compareFindings);
  const overallStatus = findings[0]?.status ?? 'READY';

  return {
    schemaVersion: '1.0',
    engineVersion: ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    cluster: analysis.cluster,
    input: { mint: analysis.mint.address },
    tokenProgram: analysis.tokenProgram,
    mint: {
      address: analysis.mint.address,
      decimals: analysis.mint.decimals,
      supplyRaw: analysis.mint.supplyRaw.toString(),
      mintAuthority: analysis.mint.mintAuthority,
      freezeAuthority: analysis.mint.freezeAuthority,
      extensions: analysis.mint.extensions.map(({ kind }) => kind).sort(),
    },
    overallStatus,
    findings,
    limitations: ['No transaction simulation is performed; supported checks are not a transfer guarantee.'],
  };
}

function buildFindings(mint: NormalizedMint): Finding[] {
  const findings = mint.extensions.map((extension) => extensionFinding(mint.address, extension));

  if (mint.freezeAuthority !== null) {
    findings.push({
      id: 'freeze-authority',
      status: 'WARNING',
      category: 'authority',
      title: 'Freeze authority is active',
      summary: 'The authority can freeze token accounts, but this does not prove an account is frozen.',
      requiredActions: ['Check source and destination account state for the transfer scenario.'],
      evidence: [{
        account: mint.address,
        accountKind: 'mint',
        field: 'freezeAuthority',
        value: mint.freezeAuthority,
      }],
    });
  }

  return findings;
}

function extensionFinding(mintAddress: string, extension: NormalizedMintExtension): Finding {
  const evidence = (field: string, value: unknown): Evidence[] => [{
    account: mintAddress,
    accountKind: 'mint',
    field,
    value,
  }];

  if (extension.kind === 'NonTransferable') {
    return {
      id: 'non-transferable',
      status: 'BLOCKED',
      category: 'transfer',
      title: 'Mint is non-transferable',
      summary: 'Token-2022 enforces this restriction on-chain for ordinary transfers.',
      requiredActions: [],
      evidence: evidence('extensions.NonTransferable', true),
      docsUrl: 'https://solana.com/docs/tokens/extensions/non-transferrable-tokens',
    };
  }

  if (extension.kind === 'TransferHook' && 'programAddress' in extension) {
    return {
      id: 'transfer-hook',
      status: 'ACTION_REQUIRED',
      category: 'transfer',
      title: 'Transfer Hook requires additional processing',
      summary: 'The transfer must invoke the configured hook with its required accounts.',
      requiredActions: ['Resolve and include the hook ExtraAccountMetaList accounts.'],
      evidence: evidence('extensions.TransferHook.programAddress', extension.programAddress),
      docsUrl: 'https://solana.com/docs/tokens/extensions/transfer-hook',
    };
  }

  return {
    id: `unknown-extension-${extension.kind}`,
    status: 'UNKNOWN',
    category: 'extension',
    title: `Unsupported extension: ${extension.kind}`,
    summary: 'This version cannot determine how the extension affects the transfer.',
    requiredActions: ['Review the extension before integrating this token.'],
    evidence: evidence(`extensions.${extension.kind}`, 'typeId' in extension ? extension.typeId : true),
  };
}

function compareFindings(left: Finding, right: Finding): number {
  return STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status] || left.id.localeCompare(right.id);
}
