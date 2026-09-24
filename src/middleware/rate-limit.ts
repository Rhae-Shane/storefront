import { Ratelimit } from '@upstash/ratelimit';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { logger } from '../logger';
import { getRedis } from '../redis';

function isExemptPath(path: string): boolean {
  return (
    path === '/health' ||
    path === '/ready' ||
    path === '/openapi.json' ||
    path === '/api/openapi' ||
    path.startsWith('/api-docs')
  );
}

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function windowLabel(windowMs: number): `${number} s` {
  const seconds = Math.max(1, Math.ceil(windowMs / 1000));
  return `${seconds} s`;
}

function createUpstashLimiter(
  prefix: string,
  max: number,
  windowMs: number,
): Ratelimit | null {
  const redis = getRedis();
  if (!redis) {
    return null;
  }
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(max, windowLabel(windowMs)),
    prefix: `shopping-cart:rl:${prefix}`,
    analytics: true,
  });
}

function upstashMiddleware(
  limiter: Ratelimit,
  opts: {
    skip?: (req: Request) => boolean;
    message: string;
  },
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (config.nodeEnv === 'test' || opts.skip?.(req)) {
        next();
        return;
      }

      const result = await limiter.limit(clientKey(req));
      res.setHeader('RateLimit-Limit', String(result.limit));
      res.setHeader('RateLimit-Remaining', String(result.remaining));
      res.setHeader('RateLimit-Reset', String(result.reset));

      if (!result.success) {
        res.status(429).json({
          statusCode: 429,
          message: opts.message,
          requestId: req.id,
        });
        return;
      }
      next();
    } catch (err) {
      // Fail open if Redis blips — prefer availability over hard lockout.
      logger.warn({ err }, 'Upstash rate limit failed; allowing request');
      next();
    }
  };
}

function memoryFallback(max: number, skip?: (req: Request) => boolean) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      statusCode: 429,
      message: 'Too many requests, please try again later',
    },
    skip: (req) => config.nodeEnv === 'test' || !!skip?.(req),
  });
}

const globalUpstash = createUpstashLimiter(
  'global',
  config.rateLimit.max,
  config.rateLimit.windowMs,
);
const writeUpstash = createUpstashLimiter(
  'write',
  config.rateLimit.writeMax,
  config.rateLimit.windowMs,
);

/** Global soft limit — shared across instances via Upstash when configured. */
export const globalRateLimiter: RequestHandler = globalUpstash
  ? upstashMiddleware(globalUpstash, {
      skip: (req) => isExemptPath(req.path),
      message: 'Too many requests, please try again later',
    })
  : memoryFallback(config.rateLimit.max, (req) => isExemptPath(req.path));

/** Stricter limit for cart writes, auth writes, and checkout. */
export const writeRateLimiter: RequestHandler = writeUpstash
  ? upstashMiddleware(writeUpstash, {
      message: 'Too many write requests, please try again later',
    })
  : memoryFallback(config.rateLimit.writeMax);
