import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PreflightReport } from '@token2022-preflight/core';
import { PreflightError } from '@token2022-preflight/solana';
import { createApp, type ApiOptions } from '../src/app.js';

const MINT = '11111111111111111111111111111111';
const apps: Array<ReturnType<typeof createApp>> = [];

function report(status: PreflightReport['overallStatus'] = 'READY'): PreflightReport {
  return {
    schemaVersion: '1.0', engineVersion: '0.1.0', generatedAt: '2026-08-19T00:00:00.000Z',
    cluster: 'devnet', input: { mint: MINT }, tokenProgram: 'token-2022',
    mint: { address: MINT, decimals: 6, supplyRaw: '1', mintAuthority: null, freezeAuthority: null, extensions: [] },
    overallStatus: status, findings: [], limitations: [],
  };
}

function app(options: Partial<ApiOptions> = {}) {
  const instance = createApp({
    rpcUrls: { devnet: 'https://devnet.example', 'mainnet-beta': 'https://mainnet.example' },
    analyzer: async () => report(),
    ...options,
  });
  apps.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (instance) => instance.close()));
});

describe('API', () => {
  it('returns health status', async () => {
    const response = await app().inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns a versioned report and keeps BLOCKED as HTTP 200', async () => {
    const response = await app({ analyzer: async () => report('BLOCKED') }).inject({
      method: 'POST', url: '/v1/preflight', payload: { cluster: 'devnet', mint: MINT },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schemaVersion: '1.0', overallStatus: 'BLOCKED' });
  });

  it('rejects invalid input before invoking the analyzer', async () => {
    const analyzer = vi.fn(async () => report());
    const response = await app({ analyzer }).inject({
      method: 'POST', url: '/v1/preflight', payload: { cluster: 'testnet', mint: 'bad' },
    });
    expect(response.statusCode).toBe(400);
    expect(analyzer).not.toHaveBeenCalled();
  });

  it('caches identical requests for a short TTL', async () => {
    const analyzer = vi.fn(async () => report());
    const instance = app({ analyzer });
    const request = { method: 'POST' as const, url: '/v1/preflight', payload: { cluster: 'devnet', mint: MINT } };
    await instance.inject(request);
    await instance.inject(request);
    expect(analyzer).toHaveBeenCalledTimes(1);
  });

  it('maps a missing mint to HTTP 404', async () => {
    const response = await app({ analyzer: async () => { throw new PreflightError('ACCOUNT_NOT_FOUND', 'not found'); } }).inject({
      method: 'POST', url: '/v1/preflight', payload: { cluster: 'devnet', mint: MINT },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'ACCOUNT_NOT_FOUND', message: 'not found' });
  });

  it('rate limits requests', async () => {
    const instance = app({ rateLimitMax: 1 });
    const request = { method: 'POST' as const, url: '/v1/preflight', payload: { cluster: 'devnet', mint: MINT } };
    expect((await instance.inject(request)).statusCode).toBe(200);
    expect((await instance.inject({ ...request, payload: { cluster: 'devnet', mint: 'SysvarRent111111111111111111111111111111111' } })).statusCode).toBe(429);
  });
});
