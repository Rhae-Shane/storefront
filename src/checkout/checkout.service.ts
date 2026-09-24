import type { PrismaClient } from '@prisma/client';
import { BadRequestError, ConflictError, NotFoundError } from '../errors';
import { stockHolds } from '../inventory/stock-holds';
import { invalidateProductListCache } from '../products/products.service';

export type UnavailableItem = {
  productId: string;
  name: string;
  requested: number;
  available: number;
};

type StockConflictError = Error & { unavailableItems: UnavailableItem[] };

function isStockConflict(err: unknown): err is StockConflictError {
  return (
    !!err &&
    typeof err === 'object' &&
    'unavailableItems' in err &&
    Array.isArray((err as StockConflictError).unavailableItems)
  );
}

export class CheckoutService {
  constructor(private readonly prisma: PrismaClient) {}

  async checkout(userId: string, idempotencyKey: string) {
    if (!idempotencyKey || idempotencyKey.length < 8) {
      throw new BadRequestError('Idempotency-Key header is required');
    }

    const existing = await this.prisma.order.findUnique({
      where: {
        userId_idempotencyKey: { userId, idempotencyKey },
      },
      include: { items: true },
    });
    if (existing) {
      return this.toOrderResponse(existing);
    }

    let cartIdForAdjust: string | null = null;
    let unavailableFromTxn: UnavailableItem[] | null = null;

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const raced = await tx.order.findUnique({
          where: {
            userId_idempotencyKey: { userId, idempotencyKey },
          },
          include: { items: true },
        });
        if (raced) {
          return this.toOrderResponse(raced);
        }

        // Load cart + live product.version inside the txn so concurrent
        // checkouts cannot race on a stale optimistic-lock snapshot.
        const cart = await tx.cart.findFirst({
          where: { userId, status: 'ACTIVE' },
          include: {
            items: { include: { product: true } },
          },
        });

        if (!cart || cart.items.length === 0) {
          throw new NotFoundError('Cart is empty');
        }
        cartIdForAdjust = cart.id;

        const unavailable: UnavailableItem[] = [];
        let totalCents = 0;
        const orderLines: {
          productId: string;
          quantity: number;
          unitPriceCents: number;
        }[] = [];

        for (const line of cart.items) {
          const expectedVersion = line.product.version;
          const decremented = await tx.$executeRaw`
            UPDATE products
            SET stock_quantity = stock_quantity - ${line.quantity},
                version = version + 1,
                updated_at = NOW()
            WHERE id = ${line.productId}::uuid
              AND stock_quantity >= ${line.quantity}
              AND version = ${expectedVersion}
          `;

          if (Number(decremented) === 0) {
            const product = await tx.product.findUnique({
              where: { id: line.productId },
            });
            unavailable.push({
              productId: line.productId,
              name: product?.name ?? 'Unknown',
              requested: line.quantity,
              available: product?.stockQuantity ?? 0,
            });
            continue;
          }

          totalCents += line.quantity * line.unitPriceCents;
          orderLines.push({
            productId: line.productId,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
          });
        }

        if (unavailable.length > 0) {
          const err = new Error('STOCK_CONFLICT') as StockConflictError;
          err.unavailableItems = unavailable;
          throw err;
        }

        // Create PENDING first (payment-hook shape), then COMPLETE in-txn for sync checkout.
        const pending = await tx.order.create({
          data: {
            userId,
            cartId: cart.id,
            totalCents,
            status: 'PENDING',
            idempotencyKey,
            items: {
              create: orderLines.map((line) => ({
                productId: line.productId,
                quantity: line.quantity,
                unitPriceCents: line.unitPriceCents,
              })),
            },
          },
        });

        // Future: await payment provider here; only COMPLETE after capture.
        const savedOrder = await tx.order.update({
          where: { id: pending.id },
          data: { status: 'COMPLETED' },
          include: { items: true },
        });

        await tx.cart.update({
          where: { id: cart.id },
          data: { status: 'CHECKED_OUT' },
        });

        await tx.cart.create({
          data: { userId, status: 'ACTIVE' },
        });

        return this.toOrderResponse(savedOrder);
      }, {
        maxWait: 15_000,
        timeout: 45_000,
      });

      // Stock changed — drop short-lived product list cache.
      await invalidateProductListCache();
      if (order.cartId) {
        await stockHolds.releaseCartHolds(
          order.cartId,
          order.items.map((i) => i.productId),
        );
      }

      return order;
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw err;
      }
      if (isStockConflict(err)) {
        unavailableFromTxn = err.unavailableItems;
      } else {
        throw err;
      }
    }

    if (cartIdForAdjust) {
      await this.adjustCartForUnavailable(cartIdForAdjust, unavailableFromTxn!);
    }

    await invalidateProductListCache();

    throw new ConflictError(
      'Some items in your cart are no longer available.',
      {
        error: 'OUT_OF_STOCK',
        message: 'Some items in your cart are no longer available.',
        unavailableItems: unavailableFromTxn,
      },
    );
  }

  private async adjustCartForUnavailable(
    cartId: string,
    unavailable: UnavailableItem[],
  ) {
    for (const item of unavailable) {
      if (item.available <= 0) {
        await this.prisma.cartItem.deleteMany({
          where: { cartId, productId: item.productId },
        });
      } else {
        await this.prisma.cartItem.updateMany({
          where: { cartId, productId: item.productId },
          data: { quantity: item.available },
        });
      }
    }
  }

  private toOrderResponse(order: {
    id: string;
    status: string;
    totalCents: number;
    cartId: string | null;
    idempotencyKey: string;
    createdAt: Date;
    items: {
      productId: string;
      quantity: number;
      unitPriceCents: number;
    }[];
  }) {
    return {
      id: order.id,
      status: order.status,
      totalCents: order.totalCents,
      cartId: order.cartId,
      idempotencyKey: order.idempotencyKey,
      items: order.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      })),
      createdAt: order.createdAt,
    };
  }
}
