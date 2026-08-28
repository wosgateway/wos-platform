/**
  * One-time migration:
 * partner-images/packages/<partner_id>/...
 *                         ↓
 * partner-images/packages/<organization_id>/...
 *
 * Migrates ONLY the 2 known package images:
 *
 * 1. สุขภาพวัยเก๋า
 * 2. ตรวจไข้วัดใหญ่
 *
 * Default mode = DRY RUN
 *
 * To actually migrate:
 *   node scripts/migrate-legacy-package-images.mjs --execute
 *
 * Requirements:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * IMPORTANT:
 * - Run this script locally/server-side only.
 * - NEVER expose SUPABASE_SERVICE_ROLE_KEY to browser/client code.
 * - The old object is deleted only after:
 *     1. new object upload succeeds
 *     2. new object is verified
 *     3. packages.image_url is updated successfully
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET = 'partner-images';

const PARTNER_ID =
  '840d0df7-9bcb-4b20-8cab-17bf5947caba';

const ORGANIZATION_ID =
  '8d9bc775-9580-4fe1-8cc9-568db6e8a635';

const MIGRATIONS = [
  {
    packageId: '55c303b1-b617-424f-ae04-a212da2184a8',
    title: 'สุขภาพวัยเก๋า',
    oldPath:
      'packages/840d0df7-9bcb-4b20-8cab-17bf5947caba/1787216326104_images__3_.jpg',
  },
  {
    packageId: '69efeab8-192a-42a1-94a5-267b1247fb5e',
    title: 'ตรวจไข้วัดใหญ่',
    oldPath:
      'packages/840d0df7-9bcb-4b20-8cab-17bf5947caba/1785563532224_Aw_Online-_________________-2026-04_0-05-73-optimized.webp',
  },
];

const EXECUTE = process.argv.includes('--execute');

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) {
  fail(
    'Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL environment variable.'
  );
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  fail(
    'Missing SUPABASE_SERVICE_ROLE_KEY environment variable.'
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

function getNewPath(oldPath) {
  const prefix = `packages/${PARTNER_ID}/`;

  if (!oldPath.startsWith(prefix)) {
    throw new Error(
      `Unexpected old path. Expected prefix "${prefix}", got "${oldPath}"`
    );
  }

  const filename = oldPath.slice(prefix.length);

  if (!filename) {
    throw new Error(`Cannot determine filename from "${oldPath}"`);
  }

  return `packages/${ORGANIZATION_ID}/${filename}`;
}

async function verifyPackage(pkg) {
  const { data, error } = await supabase
    .from('packages')
    .select('id, partner_id, title, image_url')
    .eq('id', pkg.packageId)
    .eq('partner_id', PARTNER_ID)
    .single();

  if (error) {
    throw new Error(
      `Failed to read package ${pkg.packageId}: ${error.message}`
    );
  }

  if (!data) {
    throw new Error(
      `Package ${pkg.packageId} was not found.`
    );
  }

  if (data.title !== pkg.title) {
    throw new Error(
      `Package title mismatch for ${pkg.packageId}. ` +
      `Expected "${pkg.title}", got "${data.title}".`
    );
  }

  return data;
}

async function verifyStorageObject(path) {
  const lastSlash = path.lastIndexOf('/');
  const folder = path.slice(0, lastSlash);
  const filename = path.slice(lastSlash + 1);

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(folder, {
      search: filename,
      limit: 10,
    });

  if (error) {
    throw new Error(
      `Failed to verify Storage object "${path}": ${error.message}`
    );
  }

  const found = data?.some((item) => item.name === filename);

  if (!found) {
    throw new Error(
      `Storage object "${path}" was not found after upload.`
    );
  }

  return true;
}

async function downloadObject(path) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(path);

  if (error) {
    throw new Error(
      `Failed to download "${path}": ${error.message}`
    );
  }

  if (!data || data.size === 0) {
    throw new Error(
      `Downloaded object "${path}" is empty.`
    );
  }

  return data;
}

async function uploadObject(path, blob, contentType) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType,
      upsert: false,
    });

  if (error) {
    throw new Error(
      `Failed to upload "${path}": ${error.message}`
    );
  }
}

async function updatePackageImage(packageId, newPublicUrl) {
  const { data, error } = await supabase
    .from('packages')
    .update({
      image_url: newPublicUrl,
    })
    .eq('id', packageId)
    .eq('partner_id', PARTNER_ID)
    .select('id, title, image_url')
    .single();

  if (error) {
    throw new Error(
      `Failed to update package ${packageId}: ${error.message}`
    );
  }

  return data;
}

async function deleteOldObject(path) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([path]);

  if (error) {
    throw new Error(
      `Failed to delete old object "${path}": ${error.message}`
    );
  }
}

async function migrateOne(pkg) {
  console.log(`\n----------------------------------------`);
  console.log(`Package: ${pkg.title}`);
  console.log(`Package ID: ${pkg.packageId}`);
  console.log(`Old path: ${pkg.oldPath}`);

  const newPath = getNewPath(pkg.oldPath);

  console.log(`New path: ${newPath}`);

  const currentPackage = await verifyPackage(pkg);

  console.log(`Current image_url: ${currentPackage.image_url}`);

  const expectedOldFragment =
    `/storage/v1/object/public/${BUCKET}/${pkg.oldPath}`;

  if (
    !currentPackage.image_url ||
    !currentPackage.image_url.includes(expectedOldFragment)
  ) {
    throw new Error(
      `Safety check failed: packages.image_url does not point to the expected legacy object.`
    );
  }

  if (!EXECUTE) {
    console.log(`DRY RUN: no Storage or database changes.`);
    return;
  }

  console.log(`Downloading old object...`);

  const blob = await downloadObject(pkg.oldPath);

  console.log(
    `Downloaded: ${(blob.size / 1024).toFixed(1)} KB`
  );

  const contentType =
    blob.type ||
    (
      pkg.oldPath.toLowerCase().endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg'
    );

  console.log(`Content-Type: ${contentType}`);

  console.log(`Uploading new object...`);

  await uploadObject(
    newPath,
    blob,
    contentType
  );

  console.log(`New object uploaded.`);

  console.log(`Verifying new object...`);

  await verifyStorageObject(newPath);

  console.log(`New object verified.`);

  const {
    data: publicUrlData,
  } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(newPath);

  const newPublicUrl = publicUrlData.publicUrl;

  console.log(`New public URL: ${newPublicUrl}`);

  console.log(`Updating packages.image_url...`);

  const updatedPackage = await updatePackageImage(
    pkg.packageId,
    newPublicUrl
  );

  if (updatedPackage.image_url !== newPublicUrl) {
    throw new Error(
      `Database verification failed: image_url was not updated as expected.`
    );
  }

  console.log(`Database updated successfully.`);

  console.log(`Deleting old Storage object...`);

  await deleteOldObject(pkg.oldPath);

  console.log(`Old object deleted.`);

  console.log(`✅ Migration complete: ${pkg.title}`);
}

async function main() {
  console.log(`\n========================================`);
  console.log(`Legacy package image migration`);
  console.log(`========================================`);

  console.log(`Bucket: ${BUCKET}`);
  console.log(`Partner ID: ${PARTNER_ID}`);
  console.log(`Organization ID: ${ORGANIZATION_ID}`);
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}`);

  if (!EXECUTE) {
    console.log(
      `\n⚠️ DRY RUN: nothing will be changed.`
    );
    console.log(
      `Run with --execute to perform the migration.`
    );
  } else {
    console.log(
      `\n⚠️ EXECUTE MODE: Storage and database will be modified.`
    );
  }

  for (const pkg of MIGRATIONS) {
    await migrateOne(pkg);
  }

  console.log(`\n========================================`);
  console.log(`Finished`);
  console.log(`========================================\n`);
}

main().catch((error) => {
  console.error(`\n❌ Migration failed`);
  console.error(error);
  process.exit(1);
});