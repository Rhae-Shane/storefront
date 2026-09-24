import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { pinoHttp } from 'pino-http';
import { AuthService } from './auth/auth.service';
import { createAuthRouter } from './auth/auth.routes';
import { CartService } from './cart/cart.service';
import { createCartRouter } from './cart/cart.routes';
import { CheckoutService } from './checkout/checkout.service';
import { createCheckoutRouter } from './checkout/checkout.routes';
import { prisma } from './db';
import { AppError } from './errors';
import { createHealthRouter } from './health/health.routes';
import { logger } from './logger';
import { requireAccessToken } from './middleware/auth';
import { globalRateLimiter } from './middleware/rate-limit';
import { requestIdMiddleware } from './middleware/request-id';
import { ProductsService } from './products/products.service';
import { createProductsRouter } from './products/products.routes';
import { mountSwagger } from './swagger';

export function createApp() {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).id,
      customProps: (req) => ({
        requestId: (req as Request).id,
      }),
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
      },
    }),
  );
  app.use(globalRateLimiter);
  app.use(express.json({ limit: '16kb' }));

  mountSwagger(app);
  app.use(createHealthRouter());

  const authService = new AuthService(prisma);
  const productsService = new ProductsService(prisma);
  const cartService = new CartService(prisma);
  const checkoutService = new CheckoutService(prisma);

  app.use('/api/v1/auth', createAuthRouter(authService));
  app.use('/api/v1/products', createProductsRouter(productsService));
  app.use('/api/v1/cart', createCartRouter(cartService));
  app.use(
    '/api/v1/checkout',
    requireAccessToken,
    createCheckoutRouter(checkoutService),
  );

  app.use(
    (err: unknown, req: Request, res: Response, _next: NextFunction) => {
      const requestId = req.id;

      if (err instanceof AppError) {
        logger.warn(
          { err, requestId, statusCode: err.statusCode },
          err.message,
        );
        if (err.details) {
          res.status(err.statusCode).json({
            ...err.details,
            requestId,
          });
          return;
        }
        res.status(err.statusCode).json({
          statusCode: err.statusCode,
          message: err.message,
          requestId,
        });
        return;
      }

      if (
        err instanceof SyntaxError &&
        'status' in err &&
        (err as { status?: number }).status === 400
      ) {
        res.status(400).json({
          statusCode: 400,
          message: 'Invalid JSON body',
          requestId,
        });
        return;
      }

      logger.error({ err, requestId }, 'Unhandled error');
      res.status(500).json({
        statusCode: 500,
        message: 'Internal server error',
        requestId,
      });
    },
  );

  return app;
}
