import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '../config';
import { UnauthorizedError } from '../errors';

export const API_KEY_HEADER = 'x-api-key';

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Requires `x-api-key` header matching `API_KEY` env. */
export const requireApiKey: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const provided = req.header(API_KEY_HEADER)?.trim() ?? '';
  if (!provided || !safeEqual(provided, config.apiKey)) {
    next(new UnauthorizedError('Invalid or missing API key'));
    return;
  }
  next();
};
