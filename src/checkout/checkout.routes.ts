import { Router } from 'express';
import { BadRequestError } from '../errors';
import { requireApiKey } from '../middleware/api-key';
import { writeRateLimiter } from '../middleware/rate-limit';
import { validateBody } from '../middleware/validate';
import { checkoutSchema } from '../schemas';
import { CheckoutService } from './checkout.service';

export function createCheckoutRouter(checkoutService: CheckoutService) {
  const router = Router();

  router.post(
    '/',
    requireApiKey,
    writeRateLimiter,
    validateBody(checkoutSchema),
    async (req, res, next) => {
      try {
        const headerKey = req.header('idempotency-key')?.trim();
        const bodyKey =
          typeof req.body?.idempotencyKey === 'string'
            ? req.body.idempotencyKey.trim()
            : undefined;
        const idempotencyKey = headerKey || bodyKey;
        if (!idempotencyKey) {
          throw new BadRequestError(
            'Idempotency-Key header (or body.idempotencyKey) is required',
          );
        }

        const order = await checkoutService.checkout(
          req.userId!,
          idempotencyKey,
        );
        req.log.info(
          { requestId: req.id, orderId: order.id, idempotencyKey },
          'checkout completed',
        );
        res.status(201).json(order);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
