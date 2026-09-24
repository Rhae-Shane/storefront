import { Router } from 'express';
import { BadRequestError } from '../errors';
import { requireAccessToken } from '../middleware/auth';
import { requireApiKey } from '../middleware/api-key';
import {
  CART_SESSION_HEADER,
  requireCartAccess,
} from '../middleware/cart-access';
import { writeRateLimiter } from '../middleware/rate-limit';
import { validateBody, validateParams } from '../middleware/validate';
import {
  addCartItemSchema,
  cartProductIdParamSchema,
  mergeCartSchema,
  updateCartItemSchema,
} from '../schemas';
import { CartService } from './cart.service';

export function createCartRouter(cartService: CartService) {
  const router = Router();

  router.use(requireApiKey);

  router.get('/', requireCartAccess, async (req, res, next) => {
    try {
      res.json(await cartService.getCart(req.cartOwner!));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/items',
    requireCartAccess,
    writeRateLimiter,
    validateBody(addCartItemSchema),
    async (req, res, next) => {
      try {
        const cart = await cartService.addItem(req.cartOwner!, req.body);
        req.log.info(
          { requestId: req.id, productId: req.body.productId },
          'cart item added',
        );
        res.status(201).json(cart);
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/items/:productId',
    requireCartAccess,
    writeRateLimiter,
    validateParams(cartProductIdParamSchema),
    validateBody(updateCartItemSchema),
    async (req, res, next) => {
      try {
        const cart = await cartService.updateQuantity(
          req.cartOwner!,
          String(req.params.productId),
          req.body,
        );
        req.log.info(
          { requestId: req.id, productId: req.params.productId },
          'cart item updated',
        );
        res.json(cart);
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/items/:productId',
    requireCartAccess,
    writeRateLimiter,
    validateParams(cartProductIdParamSchema),
    async (req, res, next) => {
      try {
        await cartService.removeItem(
          req.cartOwner!,
          String(req.params.productId),
        );
        req.log.info(
          { requestId: req.id, productId: req.params.productId },
          'cart item removed',
        );
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * Explicit guest → user merge. Call right after login/register with:
   *   Authorization: Bearer <access>
   *   x-cart-session: <guest session token>
   */
  router.post(
    '/merge',
    requireAccessToken,
    writeRateLimiter,
    validateBody(mergeCartSchema),
    async (req, res, next) => {
      try {
        const fromHeader = req.header(CART_SESSION_HEADER)?.trim();
        const fromBody =
          typeof req.body?.sessionToken === 'string'
            ? req.body.sessionToken.trim()
            : undefined;
        const sessionToken = fromHeader || fromBody;
        if (!sessionToken || sessionToken.length < 8) {
          throw new BadRequestError(
            'Provide guest session via x-cart-session header or body.sessionToken',
          );
        }

        await cartService.mergeGuestCartIntoUser(req.userId!, sessionToken);
        const cart = await cartService.getCart({
          kind: 'user',
          userId: req.userId!,
        });
        req.log.info(
          { requestId: req.id, userId: req.userId },
          'guest cart merged',
        );
        res.json(cart);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
