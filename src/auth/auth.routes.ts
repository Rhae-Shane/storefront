import { Router } from 'express';
import { validateBody } from '../middleware/validate';
import { writeRateLimiter } from '../middleware/rate-limit';
import {
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
} from '../schemas';
import { requireAccessToken } from '../middleware/auth';
import { AuthService } from './auth.service';

export function createAuthRouter(authService: AuthService) {
  const router = Router();

  router.post(
    '/register',
    writeRateLimiter,
    validateBody(registerSchema),
    async (req, res, next) => {
      try {
        const tokens = await authService.register(
          req.body.email,
          req.body.password,
        );
        req.log.info({ requestId: req.id }, 'user registered');
        res.status(201).json(tokens);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/login',
    writeRateLimiter,
    validateBody(loginSchema),
    async (req, res, next) => {
      try {
        const tokens = await authService.login(
          req.body.email,
          req.body.password,
        );
        req.log.info({ requestId: req.id }, 'user logged in');
        res.json(tokens);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/refresh',
    writeRateLimiter,
    validateBody(refreshSchema),
    async (req, res, next) => {
      try {
        const tokens = await authService.refresh(req.body.refreshToken);
        res.json(tokens);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/logout',
    validateBody(logoutSchema),
    async (req, res, next) => {
      try {
        await authService.logout(req.body.refreshToken);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/logout-all',
    requireAccessToken,
    async (req, res, next) => {
      try {
        await authService.logoutAll(req.userId!);
        req.log.info({ requestId: req.id, userId: req.userId }, 'logout all');
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
