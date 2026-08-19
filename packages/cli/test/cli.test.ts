import { describe, expect, it, vi } from 'vitest';

import type { PreflightReport } from '@token2022-preflight/core';
import { runCli, type CliIo } from '../src/index.js';

const MINT = '11111111111111111111111111111111';

function report(overallStatus: PreflightReport['overallStatus']): PreflightReport {
  return {
    schemaVersion: '1.0',
    engineVersion: '0.1.0',
    generatedAt: '2026-08-19T00:00:00.000Z',
    cluster: 'devnet',
    input: { mint: MINT },
    tokenProgram: 'token-2022',
    mint: {
      address: MINT,
      decimals: 6,
      supplyRaw: '1000000',
      mintAuthority: null,
      freezeAuthority: null,
      extensions: [],
    },
    overallStatus,
    findings: [],
    limitations: ['No transaction simulation is performed.'],
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

describe('runCli', () => {
  it.each([
    ['READY', 0],
    ['WARNING', 0],
    ['ACTION_REQUIRED', 2],
    ['BLOCKED', 3],
    ['UNKNOWN', 4],
  ] as const)('maps %s to exit code %i', async (status, expectedCode) => {
    const output = io();
    const result = await runCli(['inspect', MINT, '--json', '--cluster', 'devnet'], {}, output, async () => report(status));
    expect(result).toBe(expectedCode);
  });

  it('writes only valid report JSON to stdout in JSON mode', async () => {
    const output = io();
    await runCli(['inspect', MINT, '--json'], {}, output, async () => report('READY'));

    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout.join(''))).toMatchObject({ schemaVersion: '1.0', overallStatus: 'READY' });
  });

  it('uses flag RPC URL before the environment value', async () => {
    const output = io();
    const analyze = vi.fn(async () => report('READY'));
    await runCli(
      ['inspect', MINT, '--rpc-url', 'https://flag.example', '--cluster', 'devnet'],
      { SOLANA_RPC_URL: 'https://env.example' },
      output,
      analyze,
    );

    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ rpcUrl: 'https://flag.example', cluster: 'devnet' }));
  });

  it('prints a readable terminal report', async () => {
    const output = io();
    await runCli(['inspect', MINT, '--no-color'], {}, output, async () => report('WARNING'));

    expect(output.stdout.join('')).toContain('Token-2022 Preflight');
    expect(output.stdout.join('')).toContain('Status     WARNING');
  });
});
