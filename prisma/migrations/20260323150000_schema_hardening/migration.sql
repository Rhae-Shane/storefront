-- Punch-list: PENDING orders, Restrict user→order, guest carts, required idempotency, refresh FK.

-- Guest carts: nullable user_id + session_token
ALTER TABLE "carts" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "session_token" VARCHAR(128);

DROP INDEX IF EXISTS "carts_one_active_per_user";

CREATE UNIQUE INDEX IF NOT EXISTS "carts_session_token_key"
  ON "carts"("session_token");

-- One ACTIVE cart per logged-in user
CREATE UNIQUE INDEX IF NOT EXISTS "carts_one_active_per_user"
  ON "carts"("user_id")
  WHERE "status" = 'ACTIVE' AND "user_id" IS NOT NULL;

-- One ACTIVE cart per guest session
CREATE UNIQUE INDEX IF NOT EXISTS "carts_one_active_per_session"
  ON "carts"("session_token")
  WHERE "status" = 'ACTIVE' AND "session_token" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "carts_session_token_status_idx"
  ON "carts"("session_token", "status");

-- Orders: default PENDING, Restrict on user delete, idempotency NOT NULL
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_user_id_fkey";
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill missing idempotency keys then require NOT NULL
UPDATE "orders"
SET "idempotency_key" = 'legacy-' || id::text
WHERE "idempotency_key" IS NULL;

ALTER TABLE "orders" ALTER COLUMN "idempotency_key" SET NOT NULL;

-- Stock floor (belt-and-suspenders; may already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_quantity_nonnegative'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_stock_quantity_nonnegative" CHECK ("stock_quantity" >= 0);
  END IF;
END $$;

-- Refresh session rotation FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refresh_sessions_replaced_by_session_id_fkey'
  ) THEN
    ALTER TABLE "refresh_sessions"
      ADD CONSTRAINT "refresh_sessions_replaced_by_session_id_fkey"
      FOREIGN KEY ("replaced_by_session_id")
      REFERENCES "refresh_sessions"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
