import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const buckets = await prisma.$queryRawUnsafe<
      { id: string; name: string; public: boolean }[]
    >('select id, name, public from storage.buckets order by name');
    console.log('buckets:', JSON.stringify(buckets, null, 2));
  } catch (err) {
    console.error('query failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
