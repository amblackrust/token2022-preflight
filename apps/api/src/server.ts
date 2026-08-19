import { createApp } from './app.js';

const port = parsePort(process.env.PORT);
const app = createApp({
  rpcUrls: {
    devnet: requiredEnvironment('DEVNET_RPC_URL'),
    'mainnet-beta': requiredEnvironment('MAINNET_RPC_URL'),
  },
  corsOrigins: process.env.CORS_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [],
  logger: true,
});

await app.listen({ host: '0.0.0.0', port });

function requiredEnvironment(name: 'DEVNET_RPC_URL' | 'MAINNET_RPC_URL'): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be a valid TCP port');
  return port;
}
