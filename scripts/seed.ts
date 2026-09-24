import { prisma } from '../src/db';
import { SeedService } from '../src/seed/seed.service';
import { logger } from '../src/logger';

async function main() {
  const seed = new SeedService(prisma);
  await seed.run();

  const [users, products, carts] = await Promise.all([
    prisma.user.count(),
    prisma.product.count(),
    prisma.cart.count({ where: { status: 'ACTIVE' } }),
  ]);

  logger.info({ users, products, activeCarts: carts }, 'Seed complete');
}

main()
  .catch((err) => {
    console.error('Seed failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
