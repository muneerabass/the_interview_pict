import { NextResponse } from "next/server";
import { resolveProfileName } from "@/lib/utils";
import { getMongoDb } from "@/lib/mongodb";
import mongoose from "mongoose";
import { jsonError } from "@/lib/api-response";
import { getServerSession } from "next-auth/next";
import { authOptions, normalizeEmail } from "@/lib/auth";
import { toPlainText } from "@/lib/text-preview";
import { companyNameFilter } from "@/lib/companySlug";
import { checkRateLimit } from "@/lib/rate-limit";
import { fetchWithCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

const FEED_SORT_TRENDING = "trending";

function normalizeFeedSort(sort) {
  return sort === "trending" ? FEED_SORT_TRENDING : "latest";
}

function addContentTypeFilter(match, contentType) {
  if (contentType === "interview") {
    // Older experience documents predate content_type and are interviews by
    // virtue of living in the experience collection.
    match.$and = [
      {
        $or: [
          { content_type: "interview" },
          { content_type: { $exists: false } },
        ],
      },
    ];
    return;
  }

  match.content_type = contentType;
}

// "<isoDate>::<objectIdHex>" from the last item of the previous page (both
// fields the feed already returns on every item -- no extra endpoint needed).
// Only meaningful for the default `{date:-1,_id:-1}` sort: trending's window
// can widen mid-request (see the empty-result fallback below) and random's
// $sample has no stable order, so a cursor computed against either can't be
// trusted to stay valid.
function parseFeedCursor(raw) {
  if (!raw) return null;
  const separator = raw.lastIndexOf("::");
  if (separator === -1) return null;

  const date = raw.slice(0, separator);
  const idPart = raw.slice(separator + 2);
  if (!date || !mongoose.Types.ObjectId.isValid(idPart)) return null;

  return { date, id: new mongoose.Types.ObjectId(idPart) };
}

function buildPipeline({
  sort,
  page,
  itemsPerPage,
  cursor,
  companyFilter,
  collegeFilter,
  branchFilter,
  batchFilter,
  authorFilter,
  categoryFilter,
  contentType,
  searchQuery,
  authorEmails,
}) {
  const pipeline = [];
  const match = {};
  addContentTypeFilter(match, contentType || "interview");
  if (companyFilter) match.company = companyNameFilter(companyFilter);
  if (collegeFilter) match.college = collegeFilter;
  if (branchFilter) match.branch = branchFilter;
  if (batchFilter) match.batch = batchFilter;
  if (authorFilter) match.email = authorFilter;
  if (contentType === "tale" && categoryFilter) match.category = categoryFilter;
  if (searchQuery) {
    const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const contains = { $regex: escaped, $options: "i" };
    // exp_text is deliberately NOT searched: an unanchored case-insensitive regex
    // over every post body is a full collection scan no index can serve, fired on
    // every keystroke by an unauthenticated caller.
    match.$or = [
      { company: contains },
      { title: contains },
      { role: contains },
      { name: contains },
      { branch: contains },
      { college: contains },
    ];
    if (authorEmails.length > 0) match.$or.push({ email: { $in: authorEmails } });
  }

  // Real "Trending this week" logic
  if (sort === FEED_SORT_TRENDING) {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 14); // Extended to 14 days just in case low volume
    match.date = { $gte: lastWeek.toISOString() };
  }

  const usesCursor = Boolean(cursor) && sort !== FEED_SORT_TRENDING;
  if (usesCursor) {
    const cursorClause = {
      $or: [
        { date: { $lt: cursor.date } },
        { date: cursor.date, _id: { $lt: cursor.id } },
      ],
    };
    if (match.$or) {
      match.$and = [...(match.$and || []), { $or: match.$or }, cursorClause];
      delete match.$or;
    } else {
      match.$and = [...(match.$and || []), cursorClause];
    }
  }

  pipeline.push({ $match: match });

  pipeline.push(
    {
      $sort:
        sort === FEED_SORT_TRENDING
          ? { views: -1, date: -1, _id: -1 }
          : { date: -1, _id: -1 },
    },
    ...(usesCursor ? [] : [{ $skip: page * itemsPerPage }]),
    { $limit: itemsPerPage },
    {
      $lookup: {
        from: "user",
        localField: "email",
        foreignField: "gmail",
        as: "author_info",
      },
    },
    {
      $addFields: {
        author: { $arrayElemAt: ["$author_info", 0] },
      },
    },
    {
      $project: {
        author_info: 0,
      },
    }
  );
  return pipeline;
}

function processFeedResults(feed, viewerEmail) {
  return feed.map((item) => {
    const authorImage = item.author?.image || item.author?.profile_pic || item.author?.profilePic;
    const preview = toPlainText(item.preview || item.exp_text || "");

    return {
      _id: item._id,
      uid: item.uid || null,
      company: item.company || "",
      role: item.role || "",
      college: item.college || "",
      branch: item.branch || "",
      batch: item.batch || "",
      // `email` is deliberately NOT exposed: it is nobody's business publicly,
      // and it was the second half of the {email, uid} pair the delete/edit
      // IDORs needed. No client reads it.
      profile_pic: authorImage || item.profile_pic || null,
      // `likes` is stored as an array of emails; returning it raw leaked every
      // liker's address AND contradicted the "|| 0" that promised a number.
      likes: Array.isArray(item.likes) ? item.likes.length : Number(item.likes) || 0,
      // Whether *this* viewer already liked it, computed server-side so we never
      // have to ship the list of everyone's emails to the browser.
      liked: Boolean(viewerEmail) && Array.isArray(item.likes) && item.likes.includes(viewerEmail),
      views: item.views || 0,
      content_type: item.content_type || "interview",
      title: item.title || "",
      category: item.category || "",
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 6) : [],
      preview,
      name: resolveProfileName({ ...item, ...item.author }),
      date: item.date ? new Date(item.date).toISOString() : new Date().toISOString(),
    };
  });
}

export async function GET(req) {
  try {
    const rawPage = Number.parseInt(req.nextUrl.searchParams.get("page") || "0", 10);
    const rawItemsPerPage = Number.parseInt(req.nextUrl.searchParams.get("itemsPerPage") || "10", 10);
    const page = Number.isFinite(rawPage) && rawPage >= 0 ? Math.min(rawPage, 1000) : 0;
    const cursor = parseFeedCursor(req.nextUrl.searchParams.get("cursor"));
    const itemsPerPage = Number.isFinite(rawItemsPerPage) && rawItemsPerPage > 0
      ? Math.min(rawItemsPerPage, 20)
      : 10;
    const companyFilter = req.nextUrl.searchParams.get("company");
    const collegeFilter = req.nextUrl.searchParams.get("college");
    const branchFilter = req.nextUrl.searchParams.get("branch");
    const batchFilter = req.nextUrl.searchParams.get("batch");
    const authorFilter = req.nextUrl.searchParams.get("author");
    const contentType = req.nextUrl.searchParams.get("contentType") || "interview";
    const categoryFilter = contentType === "tale" ? req.nextUrl.searchParams.get("category") : "";
    const collectionName = contentType === "tale" ? "tales" : "experience";
    // A one-character query matches almost everything and still pays for the scan.
    const rawQuery = req.nextUrl.searchParams.get("q")?.trim().slice(0, 80) || "";
    const searchQuery = rawQuery.length >= 2 ? rawQuery : "";

    if (searchQuery) {
      const limited = await checkRateLimit(req, { key: "feed-search", limit: 60, windowSeconds: 60 });
      if (limited) return limited;
    }
    const sort = req.nextUrl.searchParams.get("sort") || "latest";
    // Kicked off now so it resolves alongside the DB work below instead of
    // adding its own round trip afterward.
    const sessionPromise = getServerSession(authOptions);
    const excludedIds = (req.nextUrl.searchParams.get("exclude") || "")
      .split(",")
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .slice(0, 200)
      .map((id) => new mongoose.Types.ObjectId(id));

    const db = await getMongoDb();
    if (req.nextUrl.searchParams.get("options") === "authors") {
      // Groups the whole collection with a $lookup on every call; the option list
      // barely changes, so serve it from Redis.
      const authors = await fetchWithCache(`feed_authors_v1:${contentType}`, 300, async () =>
        db.collection(collectionName).aggregate([
        { $match: { content_type: contentType, email: { $type: "string", $ne: "" } } },
        { $group: { _id: "$email", postName: { $first: "$name" } } },
        { $lookup: { from: "user", localField: "_id", foreignField: "gmail", as: "profile" } },
        { $addFields: { profile: { $arrayElemAt: ["$profile", 0] } } },
        { $project: { _id: 0, value: "$_id", label: { $ifNull: ["$profile.name", "$postName"] } } },
        { $sort: { label: 1 } },
        { $limit: 500 },
      ]).toArray()
      );
      return NextResponse.json((authors || []).filter((author) => author.label));
    }
    let authorEmails = [];
    if (searchQuery) {
      const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const contains = { $regex: escaped, $options: "i" };
      const matchingUsers = await db.collection("user").find(
        {
          $or: [
            { name: contains },
            { headline: contains },
            { currentCompany: contains },
            { college: contains },
          ],
        },
        { projection: { gmail: 1 } }
      ).limit(100).toArray();
      authorEmails = matchingUsers.map((user) => user.gmail).filter(Boolean);
    }

    // Check which collection to hit: tales or experience
    const collection = db.collection(collectionName);

    let feed = [];

    if (sort === "random") {
      const randomMatch = {};
      addContentTypeFilter(randomMatch, contentType);
      if (companyFilter) randomMatch.company = companyNameFilter(companyFilter);
      if (collegeFilter) randomMatch.college = collegeFilter;
      if (branchFilter) randomMatch.branch = branchFilter;
      if (batchFilter) randomMatch.batch = batchFilter;
      if (authorFilter) randomMatch.email = authorFilter;
      if (contentType === "tale" && categoryFilter) randomMatch.category = categoryFilter;
      if (searchQuery) {
        const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const contains = { $regex: escaped, $options: "i" };
        randomMatch.$or = [
          { company: contains },
          { title: contains },
          { role: contains },
          { name: contains },
          { branch: contains },
          { college: contains },
        ];
        if (authorEmails.length > 0) randomMatch.$or.push({ email: { $in: authorEmails } });
      }
      if (excludedIds.length > 0) randomMatch._id = { $nin: excludedIds };

      feed = await collection.aggregate([
        { $match: randomMatch },
        { $sample: { size: itemsPerPage } },
        {
          $lookup: { from: "user", localField: "email", foreignField: "gmail", as: "author_info" },
        },
        { $addFields: { author: { $arrayElemAt: ["$author_info", 0] } } },
        { $project: { author_info: 0 } }
      ]).toArray();
    } else {
      const pipeline = buildPipeline({ sort, page, itemsPerPage, cursor, companyFilter, collegeFilter, branchFilter, batchFilter, authorFilter, categoryFilter, contentType, searchQuery, authorEmails });

      feed = await collection.aggregate(pipeline).toArray();

      // Only widen to all-time once the windowed query actually comes back empty.
      // This used to delete the date filter unconditionally right after building
      // the pipeline, so "trending" was never "this week" at all.
      if (sort === "trending" && feed.length === 0) {
        const matchStage = pipeline.find((stage) => stage.$match);
        if (matchStage?.$match?.date) {
          delete matchStage.$match.date;
          feed = await collection.aggregate(pipeline).toArray();
        }
      }
    }

    const session = await sessionPromise;
    const viewerEmail = normalizeEmail(session?.user?.email);
    const data = processFeedResults(feed, viewerEmail);

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
      },
    });
  } catch (error) {
    console.error("Error fetching feed:", error?.message || error);
    return jsonError(error, "Unable to load feed");
  }
}
