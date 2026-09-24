import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BUCKET = 'product-images';

async function main() {
  await prisma.$executeRawUnsafe(
    `
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ($1, $1, true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
    on conflict (id) do update set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types
    `,
    BUCKET,
  );

  // Public read for product catalog images
  await prisma.$executeRawUnsafe(`
    drop policy if exists "Public read product-images" on storage.objects;
  `);
  await prisma.$executeRawUnsafe(`
    create policy "Public read product-images"
      on storage.objects for select
      to public
      using (bucket_id = '${BUCKET}');
  `);

  // Allow authenticated uploads (service role bypasses RLS anyway)
  await prisma.$executeRawUnsafe(`
    drop policy if exists "Authenticated upload product-images" on storage.objects;
  `);
  await prisma.$executeRawUnsafe(`
    create policy "Authenticated upload product-images"
      on storage.objects for insert
      to authenticated
      with check (bucket_id = '${BUCKET}');
  `);

  await prisma.$executeRawUnsafe(`
    drop policy if exists "Authenticated update product-images" on storage.objects;
  `);
  await prisma.$executeRawUnsafe(`
    create policy "Authenticated update product-images"
      on storage.objects for update
      to authenticated
      using (bucket_id = '${BUCKET}')
      with check (bucket_id = '${BUCKET}');
  `);

  const buckets = await prisma.$queryRawUnsafe(
    `select id, name, public, file_size_limit from storage.buckets where id = '${BUCKET}'`,
  );
  console.log(
  JSON.stringify(
    buckets,
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  ),
);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
