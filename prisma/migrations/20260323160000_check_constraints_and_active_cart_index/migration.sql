-- Explicit CHECK floors + named partial unique indexes (Prisma DSL cannot express these).

-- 1) Quantity / stock floors
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_non_negative') THEN
    ALTER TABLE products ADD CONSTRAINT stock_non_negative CHECK (stock_quantity >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_qty_positive') THEN
    ALTER TABLE cart_items ADD CONSTRAINT cart_qty_positive CHECK (quantity > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_qty_positive') THEN
    ALTER TABLE order_items ADD CONSTRAINT order_qty_positive CHECK (quantity > 0);
  END IF;
END $$;

-- Keep older named checks if present; harmless duplicates avoided via IF NOT EXISTS above.

-- 2) One ACTIVE cart per user / guest session (closes get-or-create race)
CREATE UNIQUE INDEX IF NOT EXISTS one_active_cart_per_user
  ON carts (user_id)
  WHERE status = 'ACTIVE' AND user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS one_active_cart_per_guest_session
  ON carts (session_token)
  WHERE status = 'ACTIVE' AND session_token IS NOT NULL;
