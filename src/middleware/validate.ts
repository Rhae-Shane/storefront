import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodType } from 'zod';
import { BadRequestError } from '../errors';

function formatZodError(err: ZodError): string {
  return err.issues.map((issue) => issue.message).join('; ');
}

export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestError(formatZodError(err));
    }
    throw err;
  }
}

export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = parseOrThrow(schema, req.body ?? {});
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function validateParams<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = parseOrThrow(schema, req.params);
      req.params = parsed as unknown as Request['params'];
      next();
    } catch (err) {
      next(err);
    }
  };
}
