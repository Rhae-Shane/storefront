-- Production upgrade: carts lifecycle, SKU/image/version, price snapshots, idempotency.

CREATE TYPE "CartStatus" AS ENUM ('ACTIVE', 'CHECKED_OUT', 'ABANDONED');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- Users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sku" VARCHAR(64);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "image_url" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'stock'
  ) THEN
    ALTER TABLE "products" RENAME COLUMN "stock" TO "stock_quantity";
  END IF;
END $$;

UPDATE "products"
SET "sku" = 'SKU-' || UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 12))
WHERE "sku" IS NULL;

ALTER TABLE "products" ALTER COLUMN "sku" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_sku_key') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_sku_key" UNIQUE ("sku");
  END IF;
END $$;

ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_stock_nonnegative";
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_quantity_nonnegative'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_stock_quantity_nonnegative" CHECK ("stock_quantity" >= 0);
  END IF;
END $$;

-- Carts
CREATE TABLE IF NOT EXISTS "carts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "CartStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carts_user_id_fkey') THEN
    ALTER TABLE "carts"
      ADD CONSTRAINT "carts_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "carts_user_id_status_idx" ON "carts"("user_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "carts_one_active_per_user"
  ON "carts"("user_id") WHERE "status" = 'ACTIVE';

-- Cart items → cart-scoped + price snapshot
ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "cart_id" UUID;
ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "unit_price_cents" INTEGER;
ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

INSERT INTO "carts" ("id", "user_id", "status", "created_at", "updated_at")
SELECT gen_random_uuid(), ci."user_id", 'ACTIVE', NOW(), NOW()
FROM (
  SELECT DISTINCT "user_id" FROM "cart_items" WHERE "user_id" IS NOT NULL AND "cart_id" IS NULL
) ci
WHERE NOT EXISTS (
  SELECT 1 FROM "carts" c WHERE c."user_id" = ci."user_id" AND c."status" = 'ACTIVE'
);

UPDATE "cart_items" ci
SET "cart_id" = c."id"
FROM "carts" c
WHERE ci."user_id" = c."user_id"
  AND c."status" = 'ACTIVE'
  AND ci."cart_id" IS NULL;

UPDATE "cart_items" ci
SET "unit_price_cents" = p."price_cents"
FROM "products" p
WHERE ci."product_id" = p."id"
  AND ci."unit_price_cents" IS NULL;

DELETE FROM "cart_items" WHERE "cart_id" IS NULL;

ALTER TABLE "cart_items" ALTER COLUMN "cart_id" SET NOT NULL;
ALTER TABLE "cart_items" ALTER COLUMN "unit_price_cents" SET NOT NULL;

ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_user_id_product_id_key";
ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_user_id_fkey";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cart_items' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE "cart_items" DROP COLUMN "user_id";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_cart_id_product_id_key') THEN
    ALTER TABLE "cart_items"
      ADD CONSTRAINT "cart_items_cart_id_product_id_key" UNIQUE ("cart_id", "product_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_cart_id_fkey') THEN
    ALTER TABLE "cart_items"
      ADD CONSTRAINT "cart_items_cart_id_fkey"
      FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_product_id_fkey";
ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "cart_items_cart_id_idx" ON "cart_items"("cart_id");

-- Orders
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cart_id" UUID;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(128);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "orders" SET "status" = UPPER("status") WHERE "status" IS NOT NULL;
UPDATE "orders" SET "status" = 'COMPLETED' WHERE "status" NOT IN ('PENDING', 'COMPLETED', 'CANCELLED');

ALTER TABLE "orders"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "OrderStatus" USING ("status"::"OrderStatus"),
  ALTER COLUMN "status" SET DEFAULT 'COMPLETED';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_cart_id_fkey') THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_cart_id_fkey"
      FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_user_id_idempotency_key_key') THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_user_id_idempotency_key_key" UNIQUE ("user_id", "idempotency_key");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "orders_user_id_idx" ON "orders"("user_id");
CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX IF NOT EXISTS "refresh_sessions_user_id_idx" ON "refresh_sessions"("user_id");
CREATE INDEX IF NOT EXISTS "refresh_sessions_expires_at_idx" ON "refresh_sessions"("expires_at");

ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_product_id_fkey";
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
