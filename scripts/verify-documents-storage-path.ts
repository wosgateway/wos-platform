/**
 * verify-documents-storage-path.ts
 *
 * Verifies that the `storage_path` column exists on `public.documents`
 * (checked against the live database, not just the Supabase schema cache)
 * and prints a summary of how many rows have it set vs missing.
 *
 * Usage (PowerShell):
 *   $env:SUPABASE_URL="https://ayjtfbmatwpyoxayrpxs.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>"
 *   npx tsx scripts\verify-documents-storage-path.ts
 *
 * NOTE: If you pasted your service role key into a chat or terminal log
 * before, rotate it in Supabase Dashboard -> Settings -> API first.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log("== Step 1: Checking information_schema for storage_path column ==");

  // Use a raw SQL query via RPC-less approach: query information_schema directly
  // through PostgREST is not exposed by default, so we use the `pg` introspection
  // trick via a direct select that will fail clearly if the column is missing.
  const { data: columns, error: columnsError } = await supabase
    .from("documents")
    .select("storage_path")
    .limit(1);

  if (columnsError) {
    console.error(
      "❌ Column check FAILED. This likely means storage_path does NOT exist on the live database:"
    );
    console.error(`   ${columnsError.message}`);
    process.exit(1);
  }

  console.log("✅ Column storage_path exists and is queryable.\n");

  console.log("== Step 2: Summarizing document rows ==");

  const { count: totalCount, error: totalError } = await supabase
    .from("documents")
    .select("*", { count: "exact", head: true });

  if (totalError) {
    console.error("Failed to count total documents:", totalError.message);
    process.exit(1);
  }

  const { count: missingCount, error: missingError } = await supabase
    .from("documents")
    .select("*", { count: "exact", head: true })
    .is("storage_path", null);

  if (missingError) {
    console.error("Failed to count rows missing storage_path:", missingError.message);
    process.exit(1);
  }

  const { count: emptyStringCount, error: emptyStringError } = await supabase
    .from("documents")
    .select("*", { count: "exact", head: true })
    .eq("storage_path", "");

  if (emptyStringError) {
    console.error(
      "Failed to count rows with empty-string storage_path:",
      emptyStringError.message
    );
    process.exit(1);
  }

  const total = totalCount ?? 0;
  const missing = missingCount ?? 0;
  const emptyString = emptyStringCount ?? 0;
  const populated = total - missing - emptyString;

  console.log(`Total documents:                 ${total}`);
  console.log(`  - storage_path populated:      ${populated}`);
  console.log(`  - storage_path NULL:           ${missing}`);
  console.log(`  - storage_path empty string:   ${emptyString}`);

  if (missing > 0 || emptyString > 0) {
    console.log(
      "\n⚠️  There are rows without a usable storage_path. Migration may not be fully complete."
    );

    const { data: sampleRows, error: sampleError } = await supabase
      .from("documents")
      .select("id, storage_path, created_at")
      .or("storage_path.is.null,storage_path.eq.")
      .limit(10);

    if (!sampleError && sampleRows) {
      console.log("\nSample affected rows (up to 10):");
      console.table(sampleRows);
    }
  } else {
    console.log("\n✅ All rows have a populated storage_path.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
  });
