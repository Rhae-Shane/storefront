import type { PrismaClient, Product } from '@prisma/client';
import { getRedis } from '../redis';

export const PRODUCT_LIST_CACHE_KEY = 'shopping-cart:products:list';
const LIST_CACHE_TTL_SEC = 30;

export async function invalidateProductListCache(): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    return;
  }
  await redis.del(PRODUCT_LIST_CACHE_KEY);
}

export class ProductsService {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<Product[]> {
    const redis = getRedis();
    if (redis) {
      const cached = await redis.get<Product[]>(PRODUCT_LIST_CACHE_KEY);
      if (cached) {
        return cached;
      }
    }

    const products = await this.prisma.product.findMany({
      orderBy: { name: 'asc' },
    });

    if (redis) {
      await redis.set(PRODUCT_LIST_CACHE_KEY, products, {
        ex: LIST_CACHE_TTL_SEC,
      });
    }

    return products;
  }

  findOne(id: string) {
    return this.prisma.product.findUnique({ where: { id } });
  }

  invalidateListCache() {
    return invalidateProductListCache();
  }
}
