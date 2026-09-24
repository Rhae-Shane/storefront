import { Redis } from '@upstash/redis';
import { config } from './config';
import { logger } from './logger';

let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (!config.redis.url || !config.redis.token) {
    return null;
  }
  if (!client) {
    client = new Redis({
      url: config.redis.url,
      token: config.redis.token,
    });
    logger.info('Upstash Redis client initialized');
  }
  return client;
}

export async function pingRedis(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return false;
  }
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (err) {
    logger.warn({ err }, 'Redis ping failed');
    return false;
  }
}
