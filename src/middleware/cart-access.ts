import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { UnauthorizedError } from '../errors';
import { verifyAccessToken } from '../auth/tokens';
import { cartOwnerFromRequest } from '../cart/cart-owner';

export const CART_SESSION_HEADER = 'x-cart-session';

/**
 * Cart access: Bearer JWT (logged-in) OR `x-cart-session` (guest).
 * Prefer Bearer when both are present.
 */
export const requireCartAccess: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const sessionToken = req.header(CART_SESSION_HEADER)?.trim();

  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) {
      try {
        const payload = verifyAccessToken(token);
        req.userId = payload.sub;
        req.userEmail = payload.email;
        req.cartSessionToken = sessionToken;
        const owner = cartOwnerFromRequest({
          userId: payload.sub,
          sessionToken,
        });
        req.cartOwner = owner ?? undefined;
        next();
        return;
      } catch (err) {
        next(err);
        return;
      }
    }
  }

  if (sessionToken && sessionToken.length >= 8) {
    req.cartSessionToken = sessionToken;
    req.cartOwner = { kind: 'guest', sessionToken };
    next();
    return;
  }

  next(
    new UnauthorizedError(
      'Provide Authorization Bearer token or x-cart-session header',
    ),
  );
};
