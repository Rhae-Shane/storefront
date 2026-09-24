import type { Cart, CartItem, PrismaClient, Product } from '@prisma/client';
import { ConflictError, NotFoundError } from '../errors';
import { stockHolds } from '../inventory/stock-holds';
import type { AddCartItemInput, UpdateCartItemInput } from '../schemas';
import type { CartOwner } from './cart-owner';

type CartItemWithProduct = CartItem & { product: Product };

export class CartService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Get or create the ACTIVE cart for a user or guest session. */
  async getOrCreateActiveCart(owner: CartOwner): Promise<Cart> {
    if (owner.kind === 'user') {
      const existing = await this.prisma.cart.findFirst({
        where: { userId: owner.userId, status: 'ACTIVE' },
      });
      if (existing) {
        return existing;
      }
      try {
        return await this.prisma.cart.create({
          data: { userId: owner.userId, status: 'ACTIVE' },
        });
      } catch {
        const raced = await this.prisma.cart.findFirst({
          where: { userId: owner.userId, status: 'ACTIVE' },
        });
        if (!raced) {
          throw new ConflictError('Could not create cart');
        }
        return raced;
      }
    }

    const existing = await this.prisma.cart.findFirst({
      where: { sessionToken: owner.sessionToken, status: 'ACTIVE' },
    });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.cart.create({
        data: {
          sessionToken: owner.sessionToken,
          status: 'ACTIVE',
        },
      });
    } catch {
      const raced = await this.prisma.cart.findFirst({
        where: { sessionToken: owner.sessionToken, status: 'ACTIVE' },
      });
      if (!raced) {
        throw new ConflictError('Could not create guest cart');
      }
      return raced;
    }
  }

  async getCart(owner: CartOwner) {
    const cart = await this.getOrCreateActiveCart(owner);
    const items = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      include: { product: true },
      orderBy: { addedAt: 'asc' },
    });
    return this.toCartResponse(cart, items);
  }

  async addItem(owner: CartOwner, dto: AddCartItemInput) {
    const cart = await this.getOrCreateActiveCart(owner);
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product) {
      throw new NotFoundError('Product not found');
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: {
        cartId_productId: { cartId: cart.id, productId: dto.productId },
      },
    });

    const nextQty = (existing?.quantity ?? 0) + dto.quantity;
    await this.assertAndHold({
      cartId: cart.id,
      productId: product.id,
      quantity: nextQty,
      stockQuantity: product.stockQuantity,
    });

    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: {
          quantity: nextQty,
          unitPriceCents: product.priceCents,
        },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: dto.productId,
          quantity: dto.quantity,
          unitPriceCents: product.priceCents,
        },
      });
    }

    return this.getCart(owner);
  }

  async updateQuantity(
    owner: CartOwner,
    productId: string,
    dto: UpdateCartItemInput,
  ) {
    const cart = await this.getOrCreateActiveCart(owner);
    const item = await this.prisma.cartItem.findUnique({
      where: {
        cartId_productId: { cartId: cart.id, productId },
      },
      include: { product: true },
    });
    if (!item) {
      throw new NotFoundError('Cart item not found');
    }

    await this.assertAndHold({
      cartId: cart.id,
      productId,
      quantity: dto.quantity,
      stockQuantity: item.product.stockQuantity,
    });

    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: dto.quantity },
    });
    return this.getCart(owner);
  }

  async removeItem(owner: CartOwner, productId: string): Promise<void> {
    const cart = await this.getOrCreateActiveCart(owner);
    await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id, productId },
    });
    await stockHolds.releaseHold(productId, cart.id);
  }

  /**
   * Merge guest cart into the user's ACTIVE cart on login/register, then
   * abandon the guest cart.
   */
  async mergeGuestCartIntoUser(
    userId: string,
    sessionToken: string,
  ): Promise<void> {
    const guest = await this.prisma.cart.findFirst({
      where: { sessionToken, status: 'ACTIVE' },
      include: { items: true },
    });
    if (!guest || guest.items.length === 0) {
      if (guest) {
        await this.prisma.cart.update({
          where: { id: guest.id },
          data: { status: 'ABANDONED' },
        });
      }
      return;
    }

    const userCart = await this.getOrCreateActiveCart({
      kind: 'user',
      userId,
    });

    const transferred: {
      productId: string;
      quantity: number;
      stockQuantity: number;
    }[] = [];

    await this.prisma.$transaction(
      async (tx) => {
        for (const item of guest.items) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
          });
          if (!product || product.stockQuantity <= 0) {
            continue;
          }

          const existing = await tx.cartItem.findUnique({
            where: {
              cartId_productId: {
                cartId: userCart.id,
                productId: item.productId,
              },
            },
          });

          const mergedQty = (existing?.quantity ?? 0) + item.quantity;
          const nextQty = Math.min(mergedQty, product.stockQuantity);

          if (existing) {
            await tx.cartItem.update({
              where: { id: existing.id },
              data: {
                quantity: nextQty,
                unitPriceCents: existing.unitPriceCents,
              },
            });
          } else {
            await tx.cartItem.create({
              data: {
                cartId: userCart.id,
                productId: item.productId,
                quantity: nextQty,
                unitPriceCents: item.unitPriceCents,
              },
            });
          }

          transferred.push({
            productId: item.productId,
            quantity: nextQty,
            stockQuantity: product.stockQuantity,
          });
        }

        await tx.cartItem.deleteMany({ where: { cartId: guest.id } });
        await tx.cart.update({
          where: { id: guest.id },
          data: { status: 'ABANDONED' },
        });
      },
      {
        maxWait: 10_000,
        timeout: 30_000,
      },
    );

    await stockHolds.transferHolds({
      fromCartId: guest.id,
      toCartId: userCart.id,
      lines: transferred,
    });
  }

  private async assertAndHold(params: {
    cartId: string;
    productId: string;
    quantity: number;
    stockQuantity: number;
  }) {
    const hold = await stockHolds.setHold(params);
    if (!hold.ok) {
      throw new ConflictError('INSUFFICIENT_STOCK', {
        error: 'INSUFFICIENT_STOCK',
        requested: params.quantity,
        available: hold.availableForRequest,
        reservedByOthers: hold.reservedTotal,
      });
    }
  }

  private async toCartResponse(cart: Cart, items: CartItemWithProduct[]) {
    const lines = await Promise.all(
      items.map(async (item) => {
        const livePrice = item.product.priceCents;
        const priceChanged = livePrice !== item.unitPriceCents;
        const reserved = await stockHolds.getReservedTotal(item.productId);
        // Units still free for *other* shoppers (this cart's hold is part of reserved).
        const availableStock = Math.max(
          0,
          item.product.stockQuantity - reserved + item.quantity,
        );
        return {
          cartItemId: item.id,
          productId: item.productId,
          sku: item.product.sku,
          name: item.product.name,
          imageUrl: item.product.imageUrl,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          livePriceCents: livePrice,
          priceChanged,
          lineTotalCents: item.quantity * item.unitPriceCents,
          availableStock,
        };
      }),
    );

    const totalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    return {
      cartId: cart.id,
      status: cart.status,
      sessionToken: cart.sessionToken,
      items: lines,
      totalCents,
    };
  }
}
