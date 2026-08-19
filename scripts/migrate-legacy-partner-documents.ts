// scripts/migrate-legacy-partner-documents.ts
//
// One-off migration: moves partner documents (licenses, contracts,
// certificates) that were uploaded BEFORE migration 032 out of the old
// public "partner-images" bucket and into the new private
// "partner-documents" bucket, then backfills documents.storage_path so
// the app's signed-URL logic (see DocumentsManager.tsx) picks them up.
//
// Why this can't be a SQL migration: Postgres can alter the `documents`
// table, but it cannot move objects between Supabase Storage buckets —
// that only happens through the Storage API (download + upload), which
// is why 032's SQL comment calls this out as a separate follow-up.
//
// SAFETY / DESIGN NOTES
// - Idempotent: skips any row that already has storage_path set, so it's
//   safe to re-run (e.g. after fixing a transient failure) without
//   double-moving files.
// - Does NOT delete the old object from partner-images by default. Run
//   once, verify the app works end-to-end on the new bucket, THEN do a
//   second pass (see cleanupOldPublicObjects below, off by default) to
//   remove the now-unreferenced public copies. Deleting eagerly in the
//   same pass would mean a mid-run crash leaves a document with neither
//   a working old URL nor a finished new one.
// - Requires the SERVICE ROLE key (not anon/authenticated) because it
//   needs to read every organization's documents and every bucket
//   object, bypassing RLS — same reasoning as 032's note about a future
//   admin document viewer.
//
// USAGE
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/migrate-legacy-partner-documents.ts
//   Add --delete-old to also remove the source object after a verified copy
//   (only after you've confirmed the app works against the new bucket).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DELETE_OLD = process.argv.includes('--delete-old');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars. ' +
      'Use the service role key, not anon — this script needs to bypass RLS.'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const OLD_BUCKET = 'partner-images';
const NEW_BUCKET = 'partner-documents';

interface DocumentRow {
  id: string;
  organization_id: string;
  file_url: string;
  storage_path: string | null;
}

// documents.file_url looks like:
//   https://<project>.supabase.co/storage/v1/object/public/partner-images/documents/<org_id>/<timestamp>_<filename>
// Extract the object path (everything after the bucket name) so we can
// download it from Storage directly instead of parsing organization_id
// out of the URL by hand.
function extractObjectPath(fileUrl: string, bucket: string): string | null {
  const marker = `/object/public/${bucket}/`;
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(fileUrl.slice(idx + marker.length));
}

async function migrateOne(doc: DocumentRow): Promise<'migrated' | 'skipped' | 'failed'> {
  const objectPath = extractObjectPath(doc.file_url, OLD_BUCKET);
  if (!objectPath) {
    console.warn(`[skip] doc ${doc.id}: file_url doesn't match expected ${OLD_BUCKET} public URL shape: ${doc.file_url}`);
    return 'skipped';
  }

  // 1. Download from the old public bucket.
  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from(OLD_BUCKET)
    .download(objectPath);

  if (downloadError || !fileBlob) {
    console.error(`[fail] doc ${doc.id}: download from ${OLD_BUCKET}/${objectPath} failed:`, downloadError?.message);
    return 'failed';
  }

  // 2. Upload into the new private bucket at the same path convention
  //    (documents/<organization_id>/<timestamp>_<filename> — matches the
  //    RLS policies in 032, which key off segment [2] = organization_id).
  const { error: uploadError } = await supabase.storage
    .from(NEW_BUCKET)
    .upload(objectPath, fileBlob, { upsert: true });

  if (uploadError) {
    console.error(`[fail] doc ${doc.id}: upload to ${NEW_BUCKET}/${objectPath} failed:`, uploadError.message);
    return 'failed';
  }

  // 3. Backfill storage_path so the app's signed-URL path picks this up.
  //    file_url is left as-is (still NOT NULL, still the old public URL)
  //    — DocumentsManager.tsx already prefers storage_path when present,
  //    so file_url becomes vestigial for migrated rows, not load-bearing.
  const { error: updateError } = await supabase
    .from('documents')
    .update({ storage_path: objectPath })
    .eq('id', doc.id);

  if (updateError) {
    console.error(`[fail] doc ${doc.id}: storage_path backfill failed:`, updateError.message);
    return 'failed';
  }

  if (DELETE_OLD) {
    const { error: removeError } = await supabase.storage.from(OLD_BUCKET).remove([objectPath]);
    if (removeError) {
      // Non-fatal: the document is fully migrated and working either way;
      // this only means the old public copy is still sitting there.
      console.warn(`[warn] doc ${doc.id}: migrated OK but failed to delete old object:`, removeError.message);
    }
  }

  return 'migrated';
}

async function main() {
  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, organization_id, file_url, storage_path')
    .is('storage_path', null); // idempotent: only rows not yet migrated

  if (error) {
    console.error('Failed to fetch documents:', error.message);
    process.exit(1);
  }

  if (!docs || docs.length === 0) {
    console.log('No legacy documents to migrate — all rows already have storage_path set.');
    return;
  }

  console.log(`Found ${docs.length} legacy document(s) to migrate${DELETE_OLD ? ' (will delete old objects after copy)' : ''}.`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs as DocumentRow[]) {
    const result = await migrateOne(doc);
    if (result === 'migrated') migrated++;
    else if (result === 'skipped') skipped++;
    else failed++;
  }

  console.log(`\nDone. migrated=${migrated} skipped=${skipped} failed=${failed}`);
  if (failed > 0) {
    console.log('Re-run this script to retry failed rows — it only touches rows where storage_path is still null.');
    process.exitCode = 1;
  }
  if (!DELETE_OLD && migrated > 0) {
    console.log(
      `\n${migrated} old object(s) are still sitting in the public "${OLD_BUCKET}" bucket and remain ` +
        `technically fetchable via their old file_url until removed. Once you've verified the app works ` +
        `end-to-end against the new bucket, re-run with --delete-old to clean those up.`
    );
  }
}

main();
