import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../db';
import { pingRedis } from '../redis';
import { config } from '../config';

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  router.get(
    '/ready',
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const dbOk = await checkDatabase();
        const redisConfigured = !!(config.redis.url && config.redis.token);
        const redisOk = redisConfigured ? await pingRedis() : null;

        const ready = dbOk && (redisOk === null || redisOk);
        res.status(ready ? 200 : 503).json({
          status: ready ? 'ready' : 'not_ready',
          checks: {
            database: dbOk ? 'up' : 'down',
            redis: redisOk === null ? 'skipped' : redisOk ? 'up' : 'down',
          },
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
