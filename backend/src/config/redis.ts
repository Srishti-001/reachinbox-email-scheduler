import Redis from 'ioredis';
import { config } from './index';

/**
 * Primary Redis connection used by services and rate limiter.
 * BullMQ creates its own internal connections.
 */
export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null, // required for BullMQ compatibility
  enableReadyCheck: false,
  lazyConnect: false,
});

redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('error', (err) => console.error('Redis error:', err));

export default redis;
