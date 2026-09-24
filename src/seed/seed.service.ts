import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { logger } from '../logger';
import { invalidateProductListCache } from '../products/products.service';

/** Fixed demo UUID so curl examples stay stable across restarts. */
export const DEMO_USER_ID = '11111111-1111-1111-1111-111111111111';
export const DEMO_USER_EMAIL = 'demo@shop.local';
export const DEMO_USER_PASSWORD = 'demo1234';

const STORAGE_PUBLIC =
  'https://pjzkjfhuxfnvhdcrbznz.supabase.co/storage/v1/object/public/product-images';

const img = (sku: string) => `${STORAGE_PUBLIC}/${sku}.webp`;

const CATALOG = [
  {
    sku: 'MBA-M1-13-256-SG',
    name: 'MacBook Air 13" (M1, 2020)',
    description:
      'Apple M1 chip, 8-core CPU, 7-core GPU, 8GB unified memory, 256GB SSD. Space Gray. Up to 18 hours battery life.',
    imageUrl: img('MBA-M1-13-256-SG'),
    priceCents: 99900,
    stockQuantity: 25,
  },
  {
    sku: 'MBP-M1PRO-14-512-SG',
    name: 'MacBook Pro 14" (M1 Pro)',
    description:
      'Apple M1 Pro chip, 8-core CPU, 14-core GPU, 16GB unified memory, 512GB SSD. Liquid Retina XDR display. Space Gray.',
    imageUrl: img('MBP-M1PRO-14-512-SG'),
    priceCents: 199900,
    stockQuantity: 12,
  },
  {
    sku: 'IP15-128-BLK',
    name: 'iPhone 15 128GB',
    description:
      '6.1-inch Super Retina XDR display, A16 Bionic, Dual camera system, USB-C, Dynamic Island. Black.',
    imageUrl: img('IP15-128-BLK'),
    priceCents: 79900,
    stockQuantity: 40,
  },
  {
    sku: 'IP15PRO-256-NT',
    name: 'iPhone 15 Pro 256GB',
    description:
      '6.1-inch Super Retina XDR with ProMotion, A17 Pro, titanium design, Action button, USB-C. Natural Titanium.',
    imageUrl: img('IP15PRO-256-NT'),
    priceCents: 109900,
    stockQuantity: 18,
  },
  {
    sku: 'IPAD-AIR-M1-64-BLU',
    name: 'iPad Air (M1) 64GB Wi-Fi',
    description:
      '10.9-inch Liquid Retina display, Apple M1 chip, 12MP Ultra Wide front camera, USB-C. Blue.',
    imageUrl: img('IPAD-AIR-M1-64-BLU'),
    priceCents: 59900,
    stockQuantity: 30,
  },
  {
    sku: 'AW-S9-45-GPS-MN',
    name: 'Apple Watch Series 9 GPS 45mm',
    description:
      'Always-On Retina display, S9 SiP, blood oxygen, ECG, Crash Detection. Midnight Aluminum Case with Sport Band.',
    imageUrl: img('AW-S9-45-GPS-MN'),
    priceCents: 42900,
    stockQuantity: 35,
  },
  {
    sku: 'APP-PRO-2-USB-C',
    name: 'AirPods Pro (2nd generation) USB-C',
    description:
      'Active Noise Cancellation, Adaptive Audio, Transparency mode, MagSafe Charging Case (USB-C), up to 6 hours listening.',
    imageUrl: img('APP-PRO-2-USB-C'),
    priceCents: 24900,
    stockQuantity: 50,
  },
  {
    sku: 'APP-MAX-SG',
    name: 'AirPods Max',
    description:
      'Over-ear headphones with Active Noise Cancellation, Spatial Audio, Apple-designed dynamic driver. Space Gray.',
    imageUrl: img('APP-MAX-SG'),
    priceCents: 54900,
    stockQuantity: 15,
  },
  {
    sku: 'IMAC-M1-24-256-BLU',
    name: 'iMac 24" (M1) 256GB',
    description:
      '4.5K Retina display, Apple M1 chip, 8GB memory, 256GB SSD, Two Thunderbolt / USB 4 ports. Blue.',
    imageUrl: img('IMAC-M1-24-256-BLU'),
    priceCents: 129900,
    stockQuantity: 8,
  },
  {
    sku: 'MAGIC-KB-NUM-US',
    name: 'Magic Keyboard with Numeric Keypad',
    description:
      'Scissor mechanism, rechargeable battery, Bluetooth, USB-C to Lightning cable. US English. Silver.',
    imageUrl: img('MAGIC-KB-NUM-US'),
    priceCents: 12900,
    stockQuantity: 60,
  },
  {
    sku: 'MAGIC-MOUSE-WHT',
    name: 'Magic Mouse',
    description:
      'Multi-Touch surface, Bluetooth, rechargeable. White Multi-Touch Surface.',
    imageUrl: img('MAGIC-MOUSE-WHT'),
    priceCents: 7900,
    stockQuantity: 75,
  },
  {
    sku: 'NOTE-LTD-M1-DEMO',
    name: 'Limited Edition M1 Demo Unit',
    description:
      'Only one in stock — use for checkout race / out-of-stock demos.',
    imageUrl: img('NOTE-LTD-M1-DEMO'),
    priceCents: 49900,
    stockQuantity: 1,
  },
] as const;

export class SeedService {
  constructor(private readonly prisma: PrismaClient) {}

  async run(): Promise<void> {
    const passwordHash = await bcrypt.hash(DEMO_USER_PASSWORD, 12);
    const existing = await this.prisma.user.findUnique({
      where: { id: DEMO_USER_ID },
    });

    if (!existing) {
      await this.prisma.user.create({
        data: {
          id: DEMO_USER_ID,
          email: DEMO_USER_EMAIL,
          passwordHash,
          name: 'Demo Shopper',
        },
      });
      logger.info({ userId: DEMO_USER_ID }, 'Seeded demo user');
    } else if (
      existing.passwordHash === 'demo-not-for-production' ||
      !existing.passwordHash.startsWith('$2')
    ) {
      await this.prisma.user.update({
        where: { id: DEMO_USER_ID },
        data: {
          passwordHash,
          email: DEMO_USER_EMAIL,
          name: existing.name ?? 'Demo Shopper',
        },
      });
      logger.info({ userId: DEMO_USER_ID }, 'Upgraded demo user to bcrypt hash');
    }

    const activeCart = await this.prisma.cart.findFirst({
      where: { userId: DEMO_USER_ID, status: 'ACTIVE' },
    });
    if (!activeCart) {
      await this.prisma.cart.create({
        data: { userId: DEMO_USER_ID, status: 'ACTIVE' },
      });
    }

    // Remove old placeholder SKUs from earlier seeds
    await this.prisma.product.deleteMany({
      where: {
        sku: { in: ['MOUSE-WL-001', 'HUB-USBC-7', 'NOTE-LTD-1'] },
      },
    });

    for (const item of CATALOG) {
      await this.prisma.product.upsert({
        where: { sku: item.sku },
        create: { ...item },
        update: {
          name: item.name,
          description: item.description,
          imageUrl: item.imageUrl,
          priceCents: item.priceCents,
          stockQuantity: item.stockQuantity,
        },
      });
    }
    logger.info({ count: CATALOG.length }, 'Seeded Apple product catalog');
    await invalidateProductListCache();

    logger.info(
      { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
      'Demo login credentials',
    );
  }
}
