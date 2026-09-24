import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { API_KEY_HEADER } from '../middleware/api-key';
import { REQUEST_ID_HEADER } from '../middleware/request-id';
import {
  addCartItemSchema,
  authTokensSchema,
  cartProductIdParamSchema,
  cartResponseSchema,
  checkoutSchema,
  errorResponseSchema,
  healthResponseSchema,
  loginSchema,
  logoutSchema,
  mergeCartSchema,
  orderResponseSchema,
  productIdParamSchema,
  productSchema,
  readyResponseSchema,
  refreshSchema,
  registerSchema,
  stockConflictSchema,
  updateCartItemSchema,
} from '../schemas';
import { z } from 'zod';

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'ApiKeyAuth', {
    type: 'apiKey',
    in: 'header',
    name: API_KEY_HEADER,
    description: 'API key required for cart and checkout endpoints',
  });

  registry.registerComponent('securitySchemes', 'BearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'Short-lived access JWT (default 15m) from /api/v1/auth/login or /refresh. Pair with long-lived refresh token (default 30d) stored hashed in refresh_sessions.',
  });

  const requestIdParam = {
    name: REQUEST_ID_HEADER,
    in: 'header' as const,
    required: false,
    description:
      'Optional client-supplied request ID for log correlation. If omitted, the server generates a UUID.',
    schema: { type: 'string' as const, format: 'uuid' },
  };

  const errorContent = {
    'application/json': { schema: errorResponseSchema },
  };

  const productListSchema = z.array(productSchema).openapi('ProductList');

  /** API key + (Bearer OR documented cart session — OpenAPI lists both). */
  const cartSecurity = [{ ApiKeyAuth: [], BearerAuth: [] }];

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/register',
    tags: ['Auth'],
    summary: 'Register',
    description:
      'Create an account. Returns a short-lived access JWT and a long-lived opaque refresh token (session).',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: registerSchema } },
      },
    },
    parameters: [requestIdParam],
    responses: {
      201: {
        description: 'Registered',
        content: { 'application/json': { schema: authTokensSchema } },
      },
      400: { description: 'Validation error', content: errorContent },
      409: { description: 'Email already registered', content: errorContent },
      429: { description: 'Rate limited', content: errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/login',
    tags: ['Auth'],
    summary: 'Login',
    description:
      'Exchange email/password for access JWT (short-lived) + refresh token (long-lived session).',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: loginSchema } },
      },
    },
    parameters: [requestIdParam],
    responses: {
      200: {
        description: 'Authenticated',
        content: { 'application/json': { schema: authTokensSchema } },
      },
      401: { description: 'Invalid credentials', content: errorContent },
      429: { description: 'Rate limited', content: errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/refresh',
    tags: ['Auth'],
    summary: 'Refresh Tokens',
    description:
      'Rotate refresh session: revoke the presented refresh token and issue a new access + refresh pair.',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: refreshSchema } },
      },
    },
    parameters: [requestIdParam],
    responses: {
      200: {
        description: 'Rotated',
        content: { 'application/json': { schema: authTokensSchema } },
      },
      401: { description: 'Invalid/expired refresh token', content: errorContent },
      429: { description: 'Rate limited', content: errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/logout',
    tags: ['Auth'],
    summary: 'Logout',
    description: 'Revoke a single refresh session.',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: logoutSchema } },
      },
    },
    parameters: [requestIdParam],
    responses: {
      204: { description: 'Session revoked' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/logout-all',
    tags: ['Auth'],
    summary: 'Logout All Sessions',
    description: 'Revoke all refresh sessions for the current user.',
    security: [{ BearerAuth: [] }],
    parameters: [requestIdParam],
    responses: {
      204: { description: 'All sessions revoked' },
      401: { description: 'Missing/invalid access token', content: errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/products',
    tags: ['Products'],
    summary: 'List Products',
    description: 'Returns all products ordered by name. Public.',
    parameters: [requestIdParam],
    responses: {
      200: {
        description: 'Product list',
        content: {
          'application/json': { schema: productListSchema },
        },
      },
      429: { description: 'Rate limited', content: errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/products/{id}',
    tags: ['Products'],
    summary: 'Get Product',
    description: 'Returns a single product by UUID. Public.',
    request: { params: productIdParamSchema },
    parameters: [requestIdParam],
    responses: {
      200: {
        description: 'Product',
        content: { 'application/json': { schema: productSchema } },
      },
      400: { description: 'Invalid UUID', content: errorContent },
      404: { description: 'Not found', content: errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/cart',
    tags: ['Cart'],
    summary: 'Get Cart',
    description:
      'Returns the current ACTIVE cart. Auth: Bearer JWT (user) OR `x-cart-session` (guest). Prefer Bearer when both are present.',
    security: cartSecurity,
    parameters: [requestIdParam],
    responses: {
      200: {
        description: 'Cart',
        content: { 'application/json': { schema: cartResponseSchema } },
      },
      401: { description: 'Unauthorized', content: errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/cart/items',
    tags: ['Cart'],
    summary: 'Add Cart Item',
    description:
      'Adds a product to the cart (or increments quantity). Stricter write rate limit.',
    security: cartSecurity,
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: addCartItemSchema } },
      },
    },
    parameters: [requestIdParam],
    responses: {
      201: {
        description: 'Updated cart',
        content: { 'application/json': { schema: cartResponseSchema } },
      },
      400: { description: 'Validation or stock error', content: errorContent },
      401: { description: 'Unauthorized', content: errorContent },
      404: { description: 'Product not found', content: errorContent },
      429: { description: 'Write rate limited', content: errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/cart/items/{productId}',
    tags: ['Cart'],
    summary: 'Update Cart Item Quantity',
    security: cartSecurity,
    request: {
      params: cartProductIdParamSchema,
      body: {
        required: true,
        content: { 'application/json': { schema: updateCartItemSchema } },
      },
    },
    parameters: [requestIdParam],
    responses: {
      200: {
        description: 'Updated cart',
        content: { 'application/json': { schema: cartResponseSchema } },
      },
      400: { description: 'Validation or stock error', content: errorContent },
      401: { description: 'Unauthorized', content: errorContent },
      404: { description: 'Cart item not found', content: errorContent },
      429: { description: 'Write rate limited', content: errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/cart/items/{productId}',
    tags: ['Cart'],
    summary: 'Remove Cart Item',
    security: cartSecurity,
    request: { params: cartProductIdParamSchema },
    parameters: [requestIdParam],
    responses: {
      204: { description: 'Removed (idempotent)' },
      401: { description: 'Unauthorized', content: errorContent },
      429: { description: 'Write rate limited', content: errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/cart/merge',
    tags: ['Cart'],
    summary: 'Merge Guest Cart Into User Cart',
    description:
      'Call explicitly right after login/register. Requires Bearer JWT + guest session (`x-cart-session` or body.sessionToken). Sums quantities on productId collisions, then marks the guest cart ABANDONED.',
    security: [{ ApiKeyAuth: [], BearerAuth: [] }],
    request: {
      body: {
        required: false,
        content: { 'application/json': { schema: mergeCartSchema } },
      },
    },
    parameters: [
      requestIdParam,
      {
        name: 'x-cart-session',
        in: 'header' as const,
        required: false,
        description: 'Guest cart session token (preferred over body).',
        schema: { type: 'string' as const, minLength: 8 },
      },
    ],
    responses: {
      200: {
        description: 'Merged user cart',
        content: { 'application/json': { schema: cartResponseSchema } },
      },
      400: { description: 'Missing session token', content: errorContent },
      401: { description: 'Unauthorized', content: errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/checkout',
    tags: ['Checkout'],
    summary: 'Checkout',
    description:
      'Atomic conditional stock decrement (`stock_quantity >= qty AND version = expected`) + order create. **Idempotency-Key header is required**. Order is created PENDING then flipped to COMPLETED after sync “payment” succeeds. Marks cart CHECKED_OUT and opens a new ACTIVE cart. Returns 409 OUT_OF_STOCK if stock raced away.',
    security: cartSecurity,
    request: {
      body: {
        required: false,
        content: { 'application/json': { schema: checkoutSchema } },
      },
    },
    parameters: [
      requestIdParam,
      {
        name: 'Idempotency-Key',
        in: 'header' as const,
        required: true,
        description:
          'Client-generated unique key per checkout attempt. Retries with the same key return the same order.',
        schema: { type: 'string' as const, minLength: 8, maxLength: 128 },
      },
    ],
    responses: {
      201: {
        description: 'Order created (or idempotent replay)',
        content: { 'application/json': { schema: orderResponseSchema } },
      },
      404: { description: 'Cart empty', content: errorContent },
      409: {
        description: 'Insufficient stock',
        content: { 'application/json': { schema: stockConflictSchema } },
      },
      401: { description: 'Unauthorized', content: errorContent },
      429: { description: 'Write rate limited', content: errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/health',
    tags: ['Health'],
    summary: 'Liveness Probe',
    description: 'Process is up. Does not check database.',
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: healthResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/ready',
    tags: ['Health'],
    summary: 'Readiness Probe',
    description: 'Checks PostgreSQL connectivity.',
    responses: {
      200: {
        description: 'Ready',
        content: { 'application/json': { schema: readyResponseSchema } },
      },
      503: {
        description: 'Not ready',
        content: { 'application/json': { schema: readyResponseSchema } },
      },
    },
  });

  const baseUrl =
    process.env.BASE_URL?.replace(/\/$/, '') || 'http://localhost:3002';
  const isLocalBase =
    baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');

  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Express API for Shopping Cart',
      version: '1.0.0',
      description:
        'REST API with short-lived JWT access tokens and long-lived refresh sessions. Cart/checkout require `x-api-key` and `Authorization: Bearer <accessToken>`. Built with Express, Prisma, and PostgreSQL.',
    },
    // Runtime /api/openapi overrides this with the request host. Keep BASE_URL
    // accurate for generated openapi.json and absolute links in responses.
    servers: isLocalBase
      ? [
          { url: baseUrl, description: 'Local development' },
        ]
      : [
          { url: baseUrl, description: 'Configured BASE_URL' },
          { url: 'http://localhost:3002', description: 'Local development' },
        ],
    tags: [
      { name: 'Auth', description: 'Register, login, refresh, logout' },
      { name: 'Products', description: 'Browse catalog' },
      { name: 'Cart', description: 'Cart CRUD for the authenticated user' },
      { name: 'Checkout', description: 'Place order with stock locking' },
      { name: 'Health', description: 'Liveness and readiness probes' },
    ],
  });
}
