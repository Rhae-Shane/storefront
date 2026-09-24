import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const uuidSchema = z.string().uuid('Must be a valid UUID');

export const errorResponseSchema = z
  .object({
    statusCode: z.number().int().openapi({ example: 400 }),
    message: z.string().openapi({ example: 'Validation failed' }),
    requestId: z
      .string()
      .uuid()
      .openapi({ example: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
  })
  .openapi('ErrorResponse');

export const healthResponseSchema = z
  .object({
    status: z.literal('ok'),
    timestamp: z.string().datetime(),
  })
  .openapi('HealthResponse');

export const readyResponseSchema = z
  .object({
    status: z.enum(['ready', 'not_ready']),
    checks: z.object({
      database: z.enum(['up', 'down']),
      redis: z.enum(['up', 'down', 'skipped']).optional(),
    }),
    timestamp: z.string().datetime(),
  })
  .openapi('ReadyResponse');

export const productSchema = z
  .object({
    id: uuidSchema.openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    sku: z.string().openapi({ example: 'MOUSE-WL-001' }),
    name: z.string().openapi({ example: 'Wireless Mouse' }),
    description: z
      .string()
      .nullable()
      .openapi({ example: 'Ergonomic wireless mouse' }),
    imageUrl: z
      .string()
      .nullable()
      .openapi({
        description: 'Object-store URL for the product image',
        example: 'https://cdn.example.com/products/mouse-wl-001.jpg',
      }),
    priceCents: z.number().int().openapi({ example: 2499 }),
    stockQuantity: z.number().int().openapi({ example: 10 }),
    version: z.number().int().openapi({ example: 0 }),
    createdAt: z
      .string()
      .datetime()
      .openapi({ example: '2026-03-23T05:30:00.000Z' }),
    updatedAt: z
      .string()
      .datetime()
      .openapi({ example: '2026-03-23T05:30:00.000Z' }),
  })
  .openapi('Product');

export const productIdParamSchema = z
  .object({
    id: uuidSchema.openapi({
      description: 'Product UUID',
      example: '550e8400-e29b-41d4-a716-446655440000',
    }),
  })
  .openapi('ProductIdParams');

export const addCartItemSchema = z
  .object({
    productId: uuidSchema.openapi({
      description: 'Product to add',
      example: '550e8400-e29b-41d4-a716-446655440000',
    }),
    quantity: z.coerce
      .number()
      .int()
      .min(1, 'quantity must be at least 1')
      .openapi({ example: 1 }),
  })
  .strict()
  .openapi('AddCartItemRequest');

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

export const updateCartItemSchema = z
  .object({
    quantity: z.coerce
      .number()
      .int()
      .min(1, 'quantity must be at least 1')
      .openapi({ example: 2 }),
  })
  .strict()
  .openapi('UpdateCartItemRequest');

export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;

export const cartProductIdParamSchema = z
  .object({
    productId: uuidSchema.openapi({
      description: 'Product UUID in the cart',
      example: '550e8400-e29b-41d4-a716-446655440000',
    }),
  })
  .openapi('CartProductIdParams');

export const cartLineSchema = z
  .object({
    cartItemId: uuidSchema,
    productId: uuidSchema,
    sku: z.string(),
    name: z.string(),
    imageUrl: z.string().nullable(),
    quantity: z.number().int(),
    unitPriceCents: z.number().int().openapi({
      description: 'Price snapshot when added to cart',
    }),
    livePriceCents: z.number().int().openapi({
      description: 'Current catalog price',
    }),
    priceChanged: z.boolean(),
    lineTotalCents: z.number().int(),
    availableStock: z.number().int(),
  })
  .openapi('CartLine');

export const cartResponseSchema = z
  .object({
    cartId: uuidSchema,
    status: z.enum(['ACTIVE', 'CHECKED_OUT', 'ABANDONED']),
    sessionToken: z.string().nullable(),
    items: z.array(cartLineSchema),
    totalCents: z.number().int().openapi({ example: 2499 }),
  })
  .openapi('CartResponse');

export const unavailableItemSchema = z
  .object({
    productId: uuidSchema,
    name: z.string(),
    requested: z.number().int(),
    available: z.number().int(),
  })
  .openapi('UnavailableItem');

export const orderResponseSchema = z
  .object({
    id: uuidSchema,
    status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']),
    totalCents: z.number().int().openapi({ example: 2499 }),
    cartId: uuidSchema.nullable(),
    idempotencyKey: z.string(),
    items: z.array(
      z.object({
        productId: uuidSchema,
        quantity: z.number().int(),
        unitPriceCents: z.number().int(),
      }),
    ),
    createdAt: z.string().datetime(),
  })
  .openapi('OrderResponse');

export const stockConflictSchema = z
  .object({
    error: z.enum(['INSUFFICIENT_STOCK', 'ITEM_OUT_OF_STOCK', 'OUT_OF_STOCK']),
    message: z.string(),
    unavailableItems: z.array(unavailableItemSchema).optional(),
    requested: z.number().int().optional(),
    available: z.number().int().optional(),
    requestId: z.string().uuid().optional(),
  })
  .openapi('StockConflictResponse');

/** Checkout body is empty; pass Idempotency-Key as a header only. */
export const checkoutSchema = z.object({}).strict().openapi('CheckoutRequest');

export const mergeCartSchema = z
  .object({
    sessionToken: z
      .string()
      .min(8)
      .max(128)
      .optional()
      .openapi({
        description:
          'Guest session token. Prefer x-cart-session header; body is a fallback.',
        example: 'guest-session-abc12345',
      }),
  })
  .strict()
  .openapi('MergeCartRequest');

export const registerSchema = z
  .object({
    email: z
      .email('email must be valid')
      .openapi({ example: 'demo@shop.local' }),
    password: z
      .string()
      .min(8, 'password must be at least 8 characters')
      .max(128)
      .openapi({ example: 'demo1234' }),
  })
  .strict()
  .openapi('RegisterRequest');

export const loginSchema = z
  .object({
    email: z
      .email('email must be valid')
      .openapi({ example: 'demo@shop.local' }),
    password: z
      .string()
      .min(1, 'password is required')
      .openapi({ example: 'demo1234' }),
  })
  .strict()
  .openapi('LoginRequest');

export const refreshSchema = z
  .object({
    refreshToken: z
      .string()
      .min(1, 'refreshToken is required')
      .openapi({ example: 'opaque-refresh-token' }),
  })
  .strict()
  .openapi('RefreshRequest');

export const logoutSchema = refreshSchema.openapi('LogoutRequest');

export const authTokensSchema = z
  .object({
    accessToken: z.string().openapi({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }),
    refreshToken: z.string().openapi({ example: 'opaque-refresh-token' }),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int().openapi({
      description: 'Access token lifetime in seconds',
      example: 900,
    }),
    userId: uuidSchema,
  })
  .openapi('AuthTokens');

