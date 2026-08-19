import { describe, expect, it } from 'vitest';

import {
  analyzeNormalizedToken,
  type NormalizedAnalysis,
} from '../src/index.js';

const BASE_ANALYSIS: NormalizedAnalysis = {
  cluster: 'devnet',
  mint: {
    address: 'Mint111111111111111111111111111111111111111',
    decimals: 6,
    supplyRaw: 1_000_000n,
    mintAuthority: null,
    freezeAuthority: null,
    extensions: [],
  },
  tokenProgram: 'token-2022',
};

describe('analyzeNormalizedToken', () => {
  it('blocks a non-transferable mint with on-chain evidence', () => {
    const report = analyzeNormalizedToken({
      ...BASE_ANALYSIS,
      mint: {
        ...BASE_ANALYSIS.mint,
        extensions: [{ kind: 'NonTransferable' }],
      },
    });

    expect(report.overallStatus).toBe('BLOCKED');
    expect(report.findings).toEqual([
      expect.objectContaining({
        id: 'non-transferable',
        status: 'BLOCKED',
        evidence: [
          expect.objectContaining({
            account: BASE_ANALYSIS.mint.address,
            field: 'extensions.NonTransferable',
            value: true,
          }),
        ],
      }),
    ]);
  });

  it('reports an unknown extension and does not return READY', () => {
    const report = analyzeNormalizedToken({
      ...BASE_ANALYSIS,
      mint: {
        ...BASE_ANALYSIS.mint,
        extensions: [{ kind: 'FutureTransferConstraint', typeId: 65535 }],
      },
    });

    expect(report.overallStatus).toBe('UNKNOWN');
    expect(report.findings[0]).toMatchObject({
      id: 'unknown-extension-FutureTransferConstraint',
      status: 'UNKNOWN',
    });
  });

  it('uses BLOCKED over ACTION_REQUIRED, UNKNOWN, WARNING and READY', () => {
    const report = analyzeNormalizedToken({
      ...BASE_ANALYSIS,
      mint: {
        ...BASE_ANALYSIS.mint,
        freezeAuthority: 'Freeze1111111111111111111111111111111111111',
        extensions: [
          { kind: 'TransferHook', programAddress: 'Hook111111111111111111111111111111111111111' },
          { kind: 'FutureConstraint', typeId: 65000 },
          { kind: 'NonTransferable' },
        ],
      },
    });

    expect(report.overallStatus).toBe('BLOCKED');
    expect(report.findings.map((finding) => finding.status)).toEqual([
      'BLOCKED',
      'ACTION_REQUIRED',
      'UNKNOWN',
      'WARNING',
    ]);
  });

  it('serializes bigint report fields as decimal strings', () => {
    const report = analyzeNormalizedToken(BASE_ANALYSIS);

    expect(report.mint.supplyRaw).toBe('1000000');
    expect(() => JSON.stringify(report)).not.toThrow();
  });
});
