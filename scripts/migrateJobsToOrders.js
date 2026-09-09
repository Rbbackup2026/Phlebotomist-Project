/**
 * Copy all documents from `jobs` → `orders` (same _id), then rename `jobs` → `jobs_backup`.
 *
 * Usage:
 *   node scripts/migrateJobsToOrders.js
 *   node scripts/migrateJobsToOrders.js --db=phlebo
 *   node scripts/migrateJobsToOrders.js --db=all
 *
 * Safe to re-run: existing order _ids are skipped.
 */
require("dotenv").config();
const mongoose = require("mongoose");

function parseDbArg() {
  const raw = process.argv.find((a) => a.startsWith("--db="));
  if (!raw) return null;
  return raw.slice("--db=".length).trim() || null;
}

async function migrateDb(db) {
  const jobs = db.collection("jobs");
  const orders = db.collection("orders");

  const jobCount = await jobs.countDocuments();
  const orderCountBefore = await orders.countDocuments();
  console.log(`[${db.databaseName}] jobs=${jobCount} orders(before)=${orderCountBefore}`);

  if (jobCount === 0) {
    console.log(`[${db.databaseName}] nothing to copy`);
    return { inserted: 0, skipped: 0, renamed: false };
  }

  let inserted = 0;
  let skipped = 0;
  const cursor = jobs.find({});
  // Batch insert for speed while preserving _ids
  const batch = [];
  const flush = async () => {
    if (!batch.length) return;
    try {
      const res = await orders.insertMany(batch, { ordered: false });
      inserted += res.insertedCount || Object.keys(res.insertedIds || {}).length;
    } catch (err) {
      if (err.code === 11000 || err.writeErrors) {
        const writeErrors = err.writeErrors || [];
        const ok = (err.result && err.result.nInserted) || 0;
        inserted += ok;
        skipped += writeErrors.length || batch.length - ok;
      } else {
        throw err;
      }
    }
    batch.length = 0;
  };

  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= 200) await flush();
  }
  await flush();

  const orderCountAfter = await orders.countDocuments();
  console.log(
    `[${db.databaseName}] inserted≈${inserted} skipped≈${skipped} orders(after)=${orderCountAfter}`
  );

  // Rename jobs → jobs_backup if backup name is free
  const cols = await db.listCollections({ name: "jobs_backup" }).toArray();
  let renamed = false;
  if (cols.length === 0) {
    await jobs.rename("jobs_backup");
    renamed = true;
    console.log(`[${db.databaseName}] renamed jobs → jobs_backup`);
  } else {
    console.log(`[${db.databaseName}] jobs_backup already exists — left jobs as-is`);
  }

  return { inserted, skipped, renamed };
}

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI missing in .env");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const client = mongoose.connection.getClient();
  const defaultDbName = mongoose.connection.name;
  const dbArg = parseDbArg();

  let targets = [];
  if (!dbArg || dbArg === "all") {
    const admin = client.db().admin();
    const { databases } = await admin.listDatabases({ nameOnly: true });
    const names = (databases || []).map((d) => d.name);
    // Prefer known app DBs; always include URI default
    const prefer = ["phlebo", "phlebo_local", defaultDbName].filter(
      (n, i, arr) => n && names.includes(n) && arr.indexOf(n) === i
    );
    targets = prefer.length ? prefer : [defaultDbName];
    if (dbArg === "all") {
      targets = names.filter((n) => !["admin", "local", "config"].includes(n));
    }
  } else {
    targets = [dbArg];
  }

  console.log("Migrating databases:", targets.join(", "));
  for (const name of targets) {
    await migrateDb(client.db(name));
  }

  await mongoose.disconnect();
  console.log("Done.");
})().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
