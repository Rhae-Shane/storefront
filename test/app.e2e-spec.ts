import request from 'supertest';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { prisma } from '../src/db';
import { SeedService } from '../src/seed/seed.service';

const apiKey = config.apiKey;

describe('Shopping cart API (e2e)', () => {
  const app = createApp();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-${suffix}@shop.test`;
  const password = 'e2e-test-pass-123';

  let accessToken = '';
  let refreshToken = '';
  let mouseId = '';
  let keyboardId = '';
  let guestSession = '';

  beforeAll(async () => {
    await prisma.$connect();

    let mouse = await prisma.product.findUnique({
      where: { sku: 'MAGIC-MOUSE-WHT' },
    });
    let keyboard = await prisma.product.findUnique({
      where: { sku: 'MAGIC-KB-NUM-US' },
    });

    if (!mouse || !keyboard) {
      await new SeedService(prisma).run();
      mouse = await prisma.product.findUniqueOrThrow({
        where: { sku: 'MAGIC-MOUSE-WHT' },
      });
      keyboard = await prisma.product.findUniqueOrThrow({
        where: { sku: 'MAGIC-KB-NUM-US' },
      });
    }

    mouseId = mouse.id;
    keyboardId = keyboard.id;
  }, 90_000);

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      await prisma.orderItem.deleteMany({
        where: { order: { userId: user.id } },
      });
      await prisma.order.deleteMany({ where: { userId: user.id } });
      await prisma.cartItem.deleteMany({
        where: { cart: { userId: user.id } },
      });
      await prisma.cart.deleteMany({ where: { userId: user.id } });
      await prisma.refreshSession.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    if (guestSession) {
      await prisma.cartItem.deleteMany({
        where: { cart: { sessionToken: guestSession } },
      });
      await prisma.cart.deleteMany({ where: { sessionToken: guestSession } });
    }
    await prisma.$disconnect();
  });

  it('GET /health', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /ready', async () => {
    const res = await request(app).get('/ready').expect(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database).toBe('up');
    expect(['up', 'skipped']).toContain(res.body.checks.redis);
  });

  it('GET /api/v1/products includes imageUrl', async () => {
    const res = await request(app).get('/api/v1/products').expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(12);
    expect(res.body.every((p: { imageUrl: string | null }) => !!p.imageUrl)).toBe(
      true,
    );
  });

  it('POST /api/v1/auth/register', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password })
      .expect(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('POST /api/v1/auth/refresh rotates tokens', async () => {
    const previous = refreshToken;
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.refreshToken).not.toBe(previous);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;

    // Reusing the old refresh token must revoke the family.
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: previous })
      .expect(401);

    // Current token was revoked by reuse detection — re-login.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    accessToken = login.body.accessToken;
    refreshToken = login.body.refreshToken;
  });

  it('guest cart + merge into user cart', async () => {
    guestSession = `guest-${suffix}`;

    await request(app)
      .post('/api/v1/cart/items')
      .set('x-api-key', apiKey)
      .set('x-cart-session', guestSession)
      .send({ productId: mouseId, quantity: 2 })
      .expect(201);

    const guestCart = await request(app)
      .get('/api/v1/cart')
      .set('x-api-key', apiKey)
      .set('x-cart-session', guestSession)
      .expect(200);
    expect(guestCart.body.items.length).toBe(1);

    const merged = await request(app)
      .post('/api/v1/cart/merge')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-cart-session', guestSession)
      .expect(200);
    expect(merged.body.items.some((i: { productId: string }) => i.productId === mouseId)).toBe(
      true,
    );
  });

  it('auth cart add / patch / requires api key', async () => {
    await request(app)
      .post('/api/v1/cart/items')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ productId: keyboardId, quantity: 1 })
      .expect(201);

    const patched = await request(app)
      .patch(`/api/v1/cart/items/${keyboardId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ quantity: 2 })
      .expect(200);
    const kbLine = patched.body.items.find(
      (i: { productId: string }) => i.productId === keyboardId,
    );
    expect(kbLine.quantity).toBe(2);

    await request(app)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('checkout with idempotency', async () => {
    const idem = `e2e-checkout-${suffix}`;
    const first = await request(app)
      .post('/api/v1/checkout')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', idem)
      .expect(201);
    expect(first.body.id).toBeTruthy();
    expect(first.body.status).toBe('COMPLETED');

    const replay = await request(app)
      .post('/api/v1/checkout')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', idem)
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);

    await request(app)
      .post('/api/v1/checkout')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('logout revokes refresh token', async () => {
    await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken })
      .expect(204);

    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });
});
