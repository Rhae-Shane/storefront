import { config } from '../src/config';
import { stockHolds } from '../src/inventory/stock-holds';

async function main() {
  const productId = '00000000-0000-4000-8000-000000000001';
  const cartA = '00000000-0000-4000-8000-0000000000aa';
  const cartB = '00000000-0000-4000-8000-0000000000bb';
  const stock = 2;

  console.log('redis configured:', !!(config.redis.url && config.redis.token));

  let r = await stockHolds.setHold({
    productId,
    cartId: cartA,
    quantity: 2,
    stockQuantity: stock,
  });
  console.log('A holds 2:', r);

  r = await stockHolds.setHold({
    productId,
    cartId: cartB,
    quantity: 1,
    stockQuantity: stock,
  });
  console.log('B holds 1 (should fail):', r);

  r = await stockHolds.setHold({
    productId,
    cartId: cartA,
    quantity: 1,
    stockQuantity: stock,
  });
  console.log('A reduces to 1:', r);

  r = await stockHolds.setHold({
    productId,
    cartId: cartB,
    quantity: 1,
    stockQuantity: stock,
  });
  console.log('B holds 1 (should ok):', r);

  await stockHolds.releaseCartHolds(cartA, [productId]);
  await stockHolds.releaseCartHolds(cartB, [productId]);
  console.log('released; reserved=', await stockHolds.getReservedTotal(productId));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
