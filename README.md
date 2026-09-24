# Shopping Cart

Standalone Express service (Prisma + PostgreSQL / Supabase).

Design doc: [DESIGN.md](./DESIGN.md)

## Stack

- Express 5
- Prisma 6
- PostgreSQL (Supabase)
- JWT access tokens + refresh sessions
- Zod + OpenAPI (Stoplight Elements)
- Pino logging, express-rate-limit, API key auth

## Auth model (already applied)

| Token | Lifetime (default) | Form | Storage |
| --- | --- | --- | --- |
| **Access** (short-lived) | `15m` via `JWT_ACCESS_EXPIRES_IN` | JWT — `Authorization: Bearer <token>` | Client only |
| **Refresh** (long-lived) | `30d` via `JWT_REFRESH_EXPIRES_DAYS` | Opaque random string | SHA-256 in `refresh_sessions` (rotates on `/auth/refresh`) |

Endpoints: `/api/v1/auth/register`, `/login`, `/refresh`, `/logout`, `/logout-all`.

## Cart / catalog (production schema)

- `carts` with `ACTIVE` / `CHECKED_OUT` / `ABANDONED` (one ACTIVE cart per user **or** guest session)
- Guest carts via `x-cart-session`; **explicit** `POST /api/v1/cart/merge` after login (not implicit)
- DB CHECKs: `stock_non_negative`, `cart_qty_positive`, `order_qty_positive`
- Partial unique indexes: one ACTIVE cart per user / guest session
- Cart line `unit_price_cents` price snapshot + `priceChanged` in API
- Product `sku`, `image_url` (object-store URL), `version`, `stock_quantity` + DB CHECK `>= 0`
- Checkout: atomic `UPDATE … WHERE stock_quantity >= qty AND version = expected`
- Checkout **requires** `Idempotency-Key`
- Orders default `PENDING` → `COMPLETED` after sync checkout; user delete `RESTRICT` while orders exist
    Inventory reservation window: deferred (v2 / flash-sale)
- Seed gated by `SEED_ON_START` (on by default in development/test)
- Refresh reuse detection revokes the whole session family
- Guest→user merge caps quantity to available stock
- Checkout loads cart + `product.version` inside the transaction

## Run

```bash
cp .env.example .env
# set DATABASE_URL + DIRECT_URL (Supabase pooler + direct)
npm install
npx prisma migrate deploy
npm run start:dev
```

API: `http://localhost:3002`  
Docs: `http://localhost:3002/api-docs`

Demo user: `demo@shop.local` / `demo1234`

Seed runs on boot in development/test by default. Set `SEED_ON_START=false` (or run in `production`) to skip. Use `npm run db:seed` for an explicit seed.

### Product images (Supabase Storage / S3)

Bucket `product-images` (public) on project `pjzkjfhuxfnvhdcrbznz`.

```bash
# 1) Dashboard → Storage → S3 access keys → create key pair
# 2) Add to .env:
#    S3_ACCESS_KEY_ID=...
#    S3_SECRET_ACCESS_KEY=...
#    S3_ENDPOINT=https://pjzkjfhuxfnvhdcrbznz.storage.supabase.co/storage/v1/s3
#    S3_REGION=ap-northeast-1
#    S3_BUCKET=product-images
#    SUPABASE_URL=https://pjzkjfhuxfnvhdcrbznz.supabase.co

npm run storage:create-bucket   # idempotent
npm run storage:sync-images     # download current imageUrls → upload → update DB
```

Public URL shape:  
`https://pjzkjfhuxfnvhdcrbznz.supabase.co/storage/v1/object/public/product-images/<SKU>.<ext>`

### Redis (Upstash)

Shared rate limits (global + write) and a 30s product-list cache via Upstash REST:

```env
UPSTASH_REDIS_REST_URL=https://….upstash.io
UPSTASH_REDIS_REST_TOKEN=…
```

`GET /ready` reports `checks.redis` as `up` / `down` / `skipped`. If Redis is unset, rate limiting falls back to in-memory.

Soft stock holds (15m TTL by default, `STOCK_HOLD_TTL_SECONDS`): cart add/update reserves qty in Redis so flash-sale SKUs aren’t oversold across carts. **Checkout still decrements Postgres** as the source of truth, then clears holds.

### Image pipeline

`npm run storage:sync-images:force` downloads each product image, resizes (max 1200px), converts to **WebP**, uploads to `product-images`, and updates `imageUrl`.

## API examples

### Login

```bash
curl -s -X POST http://localhost:3002/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"demo@shop.local\",\"password\":\"demo1234\"}"
```

Save `accessToken` and `refreshToken` from the response.

### Refresh (when access JWT expires)

```bash
curl -s -X POST http://localhost:3002/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"<REFRESH_TOKEN>\"}"
```

### List products

```bash
curl -s http://localhost:3002/api/v1/products
```

### Add item to cart

```bash
curl -s -X POST http://localhost:3002/api/v1/cart/items \
  -H "Content-Type: application/json" \
  -H "x-api-key: change-me-to-a-long-secret" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -d "{\"productId\":\"<PRODUCT_UUID>\",\"quantity\":1}"
```

### View cart

```bash
curl -s http://localhost:3002/api/v1/cart \
  -H "x-api-key: change-me-to-a-long-secret" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Merge guest cart (after login)

```bash
curl -s -X POST http://localhost:3002/api/v1/cart/merge \
  -H "Content-Type: application/json" \
  -H "x-api-key: change-me-to-a-long-secret" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "x-cart-session: <GUEST_SESSION_TOKEN>"
```

### Checkout

```bash
curl -i -X POST http://localhost:3002/api/v1/checkout \
  -H "Content-Type: application/json" \
  -H "x-api-key: change-me-to-a-long-secret" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Idempotency-Key: checkout-$(date +%s)"
```

### Logout

```bash
curl -i -X POST http://localhost:3002/api/v1/auth/logout \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"<REFRESH_TOKEN>\"}"
```
