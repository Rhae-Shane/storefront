import { config } from '../src/config';
import { getRedis, pingRedis } from '../src/redis';

async function main() {
  console.log('configured:', !!(config.redis.url && config.redis.token));
  console.log('ping:', await pingRedis());
  const redis = getRedis();
  if (!redis) {
    process.exit(1);
  }
  await redis.set('shopping-cart:smoke', 'ok', { ex: 10 });
  console.log('get:', await redis.get('shopping-cart:smoke'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
