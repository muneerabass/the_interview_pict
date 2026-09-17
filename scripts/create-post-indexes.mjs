#!/usr/bin/env node
/**
 * experience/tales have no Mongoose model, so nothing in this repo has ever
 * declared indexes for them -- the feed's sort/filter/join fields and the
 * single-post uid lookup have been running as unindexed collection scans.
 * Supersedes test/test_create_indexes.mjs (was never wired into any script and
 * never touched `tales` or `uid`).
 *
 * Usage:
 *   node scripts/create-post-indexes.mjs --dry-run
 *   node scripts/create-post-indexes.mjs
 */

import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

for (const file of [".env.local", ".env"]) {
  const path = join(ROOT, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is not set");
  process.exit(1);
}

// { date:-1,_id:-1 } and { views:-1,date:-1,_id:-1 } match the feed's latest/
// trending sorts (app/api/feed/route.js, app/api/topStories/route.js); the
// company one matches the feed's company filter; uid is the single-post point
// lookup (app/api/exp/route.js) -- currently the only entirely unindexed one.
const POST_INDEXES = [
  { date: -1, _id: -1 },
  { views: -1, date: -1, _id: -1 },
  { company: 1, date: -1, _id: -1 },
  { content_type: 1, email: 1 },
  { uid: 1 },
];

function describeKey(key) {
  return `{ ${Object.entries(key).map(([k, v]) => `${k}: ${v}`).join(", ")} }`;
}

async function planForCollection(collection, name) {
  const existing = await collection.indexes();
  const existingKeys = new Set(existing.map((idx) => JSON.stringify(idx.key)));
  const missing = POST_INDEXES.filter((key) => !existingKeys.has(JSON.stringify(key)));

  console.log(`\n${name}: ${existing.length} existing index(es)`);
  existing.forEach((idx) => console.log(`  have: ${describeKey(idx.key)}`));
  if (missing.length === 0) {
    console.log("  nothing to add.");
  } else {
    missing.forEach((key) => console.log(`  would create: ${describeKey(key)}`));
  }
  return missing;
}

const client = new MongoClient(process.env.MONGODB_URI);

try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "int-exp");

  const experience = db.collection("experience");
  const tales = db.collection("tales");
  const user = db.collection("user");

  const experienceMissing = await planForCollection(experience, "experience");
  const talesMissing = await planForCollection(tales, "tales");

  const userIndexes = await user.indexes();
  const hasGmailIndex = userIndexes.some((idx) => Object.keys(idx.key)[0] === "gmail");
  console.log(`\nuser: ${hasGmailIndex ? "already has" : "missing"} an index starting with gmail`);

  if (dryRun) {
    console.log("\n[dry-run] No indexes were created.");
  } else {
    for (const [collection, missing, name] of [
      [experience, experienceMissing, "experience"],
      [tales, talesMissing, "tales"],
    ]) {
      for (const key of missing) {
        console.log(`Creating ${describeKey(key)} on ${name}...`);
        await collection.createIndex(key);
      }
    }

    if (!hasGmailIndex) {
      console.log("Creating { gmail: 1 } on user...");
      // Not `unique` here: Mongoose's schema-level unique index may or may not
      // have actually been built (autoIndex can be off in production), and this
      // script has no business enforcing a data constraint -- it only needs the
      // lookup to be indexed for the feed/exp $lookup join.
      await user.createIndex({ gmail: 1 });
    }

    console.log("\nDone.");
  }
} finally {
  await client.close();
}
