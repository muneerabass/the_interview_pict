/** @type {import('next-sitemap').IConfig} */
const { MongoClient } = require("mongodb");

// next-sitemap runs as its own node process during `postbuild`, so it does not
// inherit the .env files Next loads at build time. Without this, MONGODB_URI is
// undefined here and the sitemap ships with only the static routes.
require("@next/env").loadEnvConfig(process.cwd());

// Keep in sync with lib/mongodb.js (this file is CommonJS, loaded by the
// next-sitemap CLI, so it cannot import the ESM module).
const DB_NAME = process.env.MONGODB_DB_NAME || "int-exp";

// Mirror of lib/feature-flags.js -- this file is CommonJS and cannot import it.
// Keep the two in sync when Tales ships.
const TALES_ENABLED = false;

// next-sitemap requires lastmod to be a valid W3C/ISO-8601 string; Mongo gives
// back Date objects (whose default toString() is not ISO) or already-ISO strings.
function toIsoLastmod(value) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

async function getDynamicContentPaths() {
  if (!process.env.MONGODB_URI) {
    console.warn("Dynamic sitemap paths skipped: MONGODB_URI is unavailable.");
    return [];
  }

  const client = new MongoClient(process.env.MONGODB_URI, {
    readPreference: "secondaryPreferred",
    maxStalenessSeconds: 90,
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const [interviews, tales, legacyTales, companies] = await Promise.all([
      // $ne: "tale" rather than == "interview": documents written before
      // content_type existed have no such field and were silently dropped.
      db.collection("experience").find(
        { content_type: { $ne: "tale" }, uid: { $type: "string", $ne: "" } },
        { projection: { uid: 1, date: 1 } }
      ).toArray(),
      TALES_ENABLED
        ? db.collection("tales").find(
            { uid: { $type: "string", $ne: "" } },
            { projection: { uid: 1, date: 1 } }
          ).toArray()
        : [],
      TALES_ENABLED
        ? db.collection("experience").find(
            { content_type: "tale", uid: { $type: "string", $ne: "" } },
            { projection: { uid: 1, date: 1 } }
          ).toArray()
        : [],
      db.collection("companies").find(
        { slug: { $type: "string", $ne: "" } },
        { projection: { slug: 1, updatedAt: 1, createdAt: 1 } }
      ).toArray(),
    ]);

    const postPaths = new Map();
    [...interviews, ...tales, ...legacyTales].forEach((post) => {
      if (!post.uid || postPaths.has(post.uid)) return;
      postPaths.set(post.uid, {
        loc: `/single/${encodeURIComponent(post.uid)}`,
        lastmod: toIsoLastmod(post.date),
        changefreq: "weekly",
        priority: 0.7,
      });
    });

    return [
      { loc: "/companies", changefreq: "daily", priority: 0.6 },
      ...postPaths.values(),
      ...companies.map((company) => ({
        loc: `/companies/${encodeURIComponent(company.slug)}`,
        lastmod: toIsoLastmod(company.updatedAt || company.createdAt),
        changefreq: "weekly",
        priority: 0.7,
      })),
    ];
  } catch (error) {
    console.warn("Dynamic sitemap paths unavailable:", error?.message || error);
    return [];
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = {
  siteUrl: "https://theinterviewroom.in",
  generateRobotsTxt: true,
  additionalPaths: getDynamicContentPaths,
  exclude: [
    // Placeholder page while Tales is hidden; nothing to index.
    ...(TALES_ENABLED ? [] : ["/tales"]),
    // pict.live-only surface. siteUrl here is theinterviewroom.in, where this
    // path 404s, so listing it would advertise a dead URL.
    "/placements",
    "/login",
    "/profile",
    "/post",
    "/post/*",
    "/add-company",
    "/edit",
    "/edit-company",
    "/search/*",
  ],
  robotsTxtOptions: {
    policies: [
      {
        userAgent: "*",
        // The public, shareable profile must stay crawlable. A bare
        // Disallow: /profile also blocked /profile/public/*, which cancelled out
        // the page's own indexable metadata.
        allow: ["/", "/profile/public/"],
        disallow: [
          "/login",
          "/profile",
          "/post",
          "/add-company",
          "/edit",
          "/edit-company",
          "/search",
        ],
      },
    ],
  },
};
