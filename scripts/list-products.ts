import { prisma } from '../src/db';

async function main() {
  const products = await prisma.product.findMany({
    select: { id: true, sku: true, name: true, imageUrl: true },
    orderBy: { name: 'asc' },
  });
  console.log(JSON.stringify(products, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
