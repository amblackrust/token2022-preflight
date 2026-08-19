import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { LRUCache } from "lru-cache";
import { z } from "zod";

import type { PreflightReport } from "@token2022-preflight/core";
import {
  analyzeTokenTransfer,
  PreflightError,
  type AnalyzeTokenTransferInput,
} from "@token2022-preflight/solana";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const requestSchema = z
  .object({
    cluster: z.enum(["mainnet-beta", "devnet"]),
    mint: z.string().trim().regex(SOLANA_ADDRESS),
    amountUi: z
      .string()
      .trim()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
      .optional(),
    sourceTokenAccount: z.string().trim().regex(SOLANA_ADDRESS).optional(),
    destinationTokenAccount: z.string().trim().regex(SOLANA_ADDRESS).optional(),
  })
  .strict()
  .refine(
    ({ sourceTokenAccount, destinationTokenAccount }) =>
      (sourceTokenAccount === undefined) ===
      (destinationTokenAccount === undefined),
    {
      message:
        "sourceTokenAccount and destinationTokenAccount must be provided together",
    },
  );

export interface ApiOptions {
  rpcUrls: Readonly<Record<"mainnet-beta" | "devnet", string>>;
  analyzer?: (input: AnalyzeTokenTransferInput) => Promise<PreflightReport>;
  corsOrigins?: string[];
  cacheTtlMs?: number;
  cacheMax?: number;
  rateLimitMax?: number;
  retryAttempts?: number;
  rpcTimeoutMs?: number;
  logger?: boolean;
}

export function createApp(options: ApiOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 16 * 1024,
    requestIdHeader: "x-request-id",
  });
  const cache = new LRUCache<string, PreflightReport>({
    max: options.cacheMax ?? 500,
    ttl: options.cacheTtlMs ?? 30_000,
  });
  const analyzer = options.analyzer ?? analyzeTokenTransfer;

  void app.register(async (routes) => {
    await routes.register(cors, {
      origin: options.corsOrigins?.length ? options.corsOrigins : false,
    });
    await routes.register(rateLimit, {
      global: true,
      max: options.rateLimitMax ?? 30,
      timeWindow: "1 minute",
    });

    routes.get("/health", async () => ({ status: "ok" }));
    routes.post("/v1/preflight", async (request, reply) => {
      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ code: "INVALID_INPUT", message: "Request body is invalid" });
      }
      const cacheKey = JSON.stringify(parsed.data);
      const cached = cache.get(cacheKey);
      if (cached !== undefined) return cached;

      const analysisInput: AnalyzeTokenTransferInput = {
        cluster: parsed.data.cluster,
        mint: parsed.data.mint,
        rpcUrl: options.rpcUrls[parsed.data.cluster],
        timeoutMs: options.rpcTimeoutMs ?? 8_000,
        ...(parsed.data.amountUi === undefined
          ? {}
          : { amountUi: parsed.data.amountUi }),
        ...(parsed.data.sourceTokenAccount === undefined
          ? {}
          : { sourceTokenAccount: parsed.data.sourceTokenAccount }),
        ...(parsed.data.destinationTokenAccount === undefined
          ? {}
          : { destinationTokenAccount: parsed.data.destinationTokenAccount }),
      };
      const report = await analyzeWithRetry(
        analyzer,
        analysisInput,
        options.retryAttempts ?? 2,
      );
      cache.set(cacheKey, report);
      return report;
    });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof PreflightError) {
      return reply
        .code(httpStatus(error.code))
        .send({ code: error.code, message: error.message });
    }
    if (
      error instanceof Error &&
      "statusCode" in error &&
      error.statusCode === 429
    ) {
      return reply
        .code(429)
        .send({ code: "RATE_LIMITED", message: "Too many requests" });
    }
    return reply
      .code(500)
      .send({ code: "UNEXPECTED_ERROR", message: "Unexpected server error" });
  });
  return app;
}

async function analyzeWithRetry(
  analyzer: (input: AnalyzeTokenTransferInput) => Promise<PreflightReport>,
  input: AnalyzeTokenTransferInput,
  attempts: number,
): Promise<PreflightReport> {
  const boundedAttempts = Math.max(1, Math.min(attempts, 3));
  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    try {
      return await analyzer(input);
    } catch (error) {
      const transient =
        error instanceof PreflightError &&
        (error.code === "RPC_UNAVAILABLE" || error.code === "RPC_TIMEOUT");
      if (!transient || attempt === boundedAttempts) throw error;
    }
  }
  throw new PreflightError("UNEXPECTED_ERROR", "Retry loop exhausted");
}

function httpStatus(
  code: PreflightError["code"],
): 400 | 404 | 429 | 500 | 502 | 503 {
  switch (code) {
    case "INVALID_ADDRESS":
    case "INVALID_AMOUNT":
    case "UNSUPPORTED_OWNER":
    case "TOKEN_ACCOUNT_DECODE_FAILED":
    case "MINT_MISMATCH":
      return 400;
    case "ACCOUNT_NOT_FOUND":
      return 404;
    case "RPC_RATE_LIMITED":
      return 429;
    case "RPC_TIMEOUT":
      return 503;
    case "RPC_UNAVAILABLE":
      return 502;
    default:
      return 500;
  }
}
