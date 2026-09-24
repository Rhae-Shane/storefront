import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { UnauthorizedError } from '../errors';
import { verifyAccessToken } from '../auth/tokens';

/** Requires `Authorization: Bearer <accessToken>`. */
export const requireAccessToken: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing or invalid Authorization header'));
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    next(new UnauthorizedError('Missing access token'));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    next();
  } catch (err) {
    next(err);
  }
};
