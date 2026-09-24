import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { config } from '../src/config';
import { prisma } from '../src/db';

const MAX_WIDTH = 1200;
const WEBP_QUALITY = 82;

function requireS3Credentials() {
  const { accessKeyId, secretAccessKey, endpoint, region, bucket } =
    config.storage;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      [
        'Missing S3 credentials.',
        'Add to .env:',
        '  S3_ACCESS_KEY_ID=...',
        '  S3_SECRET_ACCESS_KEY=...',
      ].join('\n'),
    );
  }
  return { accessKeyId, secretAccessKey, endpoint, region, bucket };
}

function createS3Client() {
  const creds = requireS3Credentials();
  return new S3Client({
    forcePathStyle: true,
    region: creds.region,
    endpoint: creds.endpoint,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  });
}

async function ensureBucket(client: S3Client, bucket: string) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`bucket ok: ${bucket}`);
  } catch {
    console.log(`creating bucket: ${bucket}`);
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

function publicUrl(objectKey: string): string {
  return `${config.storage.publicObjectBase}/${objectKey}`;
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'shopping-cart-image-sync/1.0' },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`download failed ${res.status} for ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function toWebp(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({
      width: MAX_WIDTH,
      height: MAX_WIDTH,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

function objectKeyFromUrl(url: string): string | null {
  const base = config.storage.publicObjectBase + '/';
  if (!url.startsWith(base)) {
    return null;
  }
  return url.slice(base.length);
}

async function downloadWithFallback(
  sku: string,
  imageUrl: string,
): Promise<Buffer> {
  try {
    return await download(imageUrl);
  } catch (first) {
    const candidates = ['png', 'jpg', 'jpeg', 'webp'].map(
      (ext) => `${config.storage.publicObjectBase}/${sku}.${ext}`,
    );
    for (const alt of candidates) {
      if (alt === imageUrl) continue;
      try {
        console.log(`  fallback ${alt}`);
        return await download(alt);
      } catch {
        // try next
      }
    }
    throw first;
  }
}

async function main() {
  const force =
    process.argv.includes('--force') || process.env.FORCE_IMAGE_SYNC === '1';
  const { bucket } = requireS3Credentials();
  const client = createS3Client();
  await ensureBucket(client, bucket);

  const products = await prisma.product.findMany({
    select: { id: true, sku: true, imageUrl: true },
    orderBy: { sku: 'asc' },
  });

  if (products.length === 0) {
    throw new Error('No products found — run npm run db:seed first');
  }

  const updated: { sku: string; imageUrl: string; bytes: number }[] = [];

  for (const product of products) {
    if (!product.imageUrl) {
      console.warn(`skip ${product.sku}: no source imageUrl`);
      continue;
    }

    const alreadyWebp =
      product.imageUrl.startsWith(config.storage.publicObjectBase) &&
      product.imageUrl.endsWith('.webp');

    if (alreadyWebp && !force) {
      console.log(`skip ${product.sku}: already WebP on Storage`);
      updated.push({ sku: product.sku, imageUrl: product.imageUrl, bytes: 0 });
      continue;
    }

    console.log(`process ${product.sku} …`);
    const raw = await downloadWithFallback(product.sku, product.imageUrl);
    const webp = await toWebp(raw);
    const key = `${product.sku}.webp`;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: webp,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    // Remove previous non-webp variants for this SKU.
    for (const ext of ['png', 'jpg', 'jpeg']) {
      const oldKey = `${product.sku}.${ext}`;
      if (oldKey === key) continue;
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: oldKey }),
        );
      } catch {
        // ignore
      }
    }

    const imageUrl = publicUrl(key);
    await prisma.product.update({
      where: { id: product.id },
      data: { imageUrl },
    });

    console.log(
      `  -> ${imageUrl} (${raw.length} → ${webp.length} bytes, -${Math.round((1 - webp.length / raw.length) * 100)}%)`,
    );
    updated.push({ sku: product.sku, imageUrl, bytes: webp.length });
  }

  console.log('\nDone:');
  for (const row of updated) {
    console.log(`  ${row.sku}: ${row.imageUrl}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
