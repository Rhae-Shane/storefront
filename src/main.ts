import { createApp } from './app';
import { config } from './config';
import { prisma } from './db';
import { logger } from './logger';
import { SeedService } from './seed/seed.service';

async function main() {
  await prisma.$connect();

  if (config.seedOnStart) {
    const seed = new SeedService(prisma);
    await seed.run();
  } else {
    logger.info('Skipping seed (SEED_ON_START disabled)');
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv },
      `Shopping Cart listening on http://localhost:${config.port}`,
    );
    logger.info(`API docs: http://localhost:${config.port}/api-docs`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(async (err) => {
  logger.error({ err }, 'Failed to start server');
  await prisma.$disconnect();
  process.exit(1);
});
