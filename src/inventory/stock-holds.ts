import { getRedis } from '../redis';
import { config } from '../config';
import { logger } from '../logger';

const HOLD_PREFIX = 'shopping-cart:stock-holds';

function holdsKey(productId: string): string {
  return `${HOLD_PREFIX}:${productId}`;
}

/**
 * Soft stock reservation in Redis (flash-sale friendly).
 * Postgres remains source of truth at checkout.
 *
 * One hash per product: field = cartId, value = qty.
 * Hash TTL refreshed on every change so idle carts release inventory.
 */
export class StockHoldService {
  /**
   * Reserve `quantity` units for `cartId` on `productId`.
   * Pass quantity=0 to release this cart's hold.
   * Returns sellable remaining for everyone else after this hold, or throws via caller.
   */
  async setHold(params: {
    productId: string;
    cartId: string;
    quantity: number;
    stockQuantity: number;
  }): Promise<{
    ok: boolean;
    availableForRequest: number;
    reservedTotal: number;
  }> {
    const redis = getRedis();
    const { productId, cartId, quantity, stockQuantity } = params;
    const ttl = config.stockHold.ttlSeconds;

    if (!redis) {
      // No Redis — caller falls back to DB-only check.
      return {
        ok: quantity <= stockQuantity,
        availableForRequest: stockQuantity,
        reservedTotal: 0,
      };
    }

    try {
      const result = await redis.eval(
        STOCK_HOLD_LUA,
        [holdsKey(productId)],
        [cartId, String(quantity), String(stockQuantity), String(ttl)],
      );

      const ok = result[0] === 1;
      return {
        ok,
        availableForRequest: result[1],
        reservedTotal: result[2],
      };
    } catch (err) {
      logger.warn(
        { err, productId, cartId },
        'stock hold failed; DB-only check',
      );
      return {
        ok: quantity <= stockQuantity,
        availableForRequest: stockQuantity,
        reservedTotal: 0,
      };
    }
  }

  async releaseHold(productId: string, cartId: string): Promise<void> {
    await this.setHold({
      productId,
      cartId,
      quantity: 0,
      stockQuantity: Number.MAX_SAFE_INTEGER,
    });
  }

  async releaseCartHolds(cartId: string, productIds: string[]): Promise<void> {
    await Promise.all(
      productIds.map((productId) => this.releaseHold(productId, cartId)),
    );
  }

  /** Transfer guest holds onto the user cart (merge). */
  async transferHolds(params: {
    fromCartId: string;
    toCartId: string;
    lines: { productId: string; quantity: number; stockQuantity: number }[];
  }): Promise<void> {
    const { fromCartId, toCartId, lines } = params;
    for (const line of lines) {
      await this.releaseHold(line.productId, fromCartId);
      if (line.quantity > 0) {
        await this.setHold({
          productId: line.productId,
          cartId: toCartId,
          quantity: line.quantity,
          stockQuantity: line.stockQuantity,
        });
      }
    }
  }

  async getReservedTotal(productId: string): Promise<number> {
    const redis = getRedis();
    if (!redis) {
      return 0;
    }
    try {
      const values = await redis.hvals(holdsKey(productId));
      return values.reduce(
        (sum: number, v: string | number) => sum + Number(v || 0),
        0,
      );
    } catch {
      return 0;
    }
  }
}

/**
 * Atomic soft-hold update.
 * Returns {ok, availableForThisCart, reservedTotal}
 * availableForThisCart = stock - (others' holds) when ok is false (max they can take),
 * or stock - reservedTotal when ok.
 */
const STOCK_HOLD_LUA = `
local key = KEYS[1]
local cartId = ARGV[1]
local newQty = tonumber(ARGV[2])
local stock = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local old = tonumber(redis.call('HGET', key, cartId) or '0')
local vals = redis.call('HVALS', key)
local sum = 0
for _, v in ipairs(vals) do
  sum = sum + tonumber(v)
end
local others = sum - old
local nextTotal = others + newQty

if newQty > 0 and nextTotal > stock then
  local available = stock - others
  if available < 0 then available = 0 end
  return {0, available, sum}
end

if newQty <= 0 then
  redis.call('HDEL', key, cartId)
else
  redis.call('HSET', key, cartId, newQty)
end

if redis.call('HLEN', key) == 0 then
  redis.call('DEL', key)
  return {1, stock, 0}
end

redis.call('EXPIRE', key, ttl)
local reserved = others + math.max(newQty, 0)
return {1, stock - reserved, reserved}
`;

export const stockHolds = new StockHoldService();
