import { redis } from '../config/redis';
import { config } from '../config';

/**
 * Redis-backed hourly rate limiter for per-sender email sending.
 *
 * Key structure: rate:{senderAccountId}:{hourWindow}
 *   where hourWindow = Math.floor(Date.now() / 3_600_000)
 *
 * This is purely slot-based counting — no sliding window needed because
 * Ethereal and the assignment spec both define limits per clock-hour bucket.
 *
 * The Lua script makes the INCR + GET atomic, so it is safe across multiple
 * worker processes sharing the same Redis instance.
 */

const RATE_LIMIT_SCRIPT = `
local key   = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl   = tonumber(ARGV[2])

local current = redis.call('INCR', key)
if current == 1 then
  -- First increment in this window — set the TTL so the key auto-expires
  redis.call('EXPIRE', key, ttl)
end

if current > limit then
  return -1   -- over limit
else
  return current  -- accepted, returns current count in this window
end
`;

/**
 * Returns the current one-hour bucket as an integer (unix hours).
 */
function currentHourWindow(): number {
  return Math.floor(Date.now() / 3_600_000);
}

/**
 * Attempts to consume one slot in the hourly rate limit for a sender.
 *
 * @param senderAccountId  DB UUID of the sender
 * @param hourlyLimit      Max emails per hour for this campaign
 * @returns { allowed: true, count } if within limit
 *          { allowed: false, msUntilNextWindow } if over limit
 */
export async function checkAndConsume(
  senderAccountId: string,
  hourlyLimit: number
): Promise<
  | { allowed: true; count: number }
  | { allowed: false; msUntilNextWindow: number }
> {
  const window = currentHourWindow();
  const key    = `rate:${senderAccountId}:${window}`;
  // TTL = 2 hours so the key survives one full window plus a buffer
  const ttlSeconds = 7200;

  const result = await redis.eval(
    RATE_LIMIT_SCRIPT,
    1,       // number of KEYS
    key,     // KEYS[1]
    String(hourlyLimit),
    String(ttlSeconds)
  ) as number;

  if (result === -1) {
    // Calculate ms remaining until the next hour window starts
    const nextWindowStart = (window + 1) * 3_600_000;
    const msUntilNextWindow = nextWindowStart - Date.now();
    return { allowed: false, msUntilNextWindow };
  }

  return { allowed: true, count: result };
}

/**
 * Returns the current consumed count for a sender in the current hour window.
 * Used for diagnostics / API responses only — does NOT consume a slot.
 */
export async function getCurrentCount(senderAccountId: string): Promise<number> {
  const window = currentHourWindow();
  const key    = `rate:${senderAccountId}:${window}`;
  const val    = await redis.get(key);
  return val ? parseInt(val, 10) : 0;
}
