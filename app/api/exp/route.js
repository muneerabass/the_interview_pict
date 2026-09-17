import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getMongoDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/api-response";
import { toPublicPost } from "@/lib/post-shape";
import { fetchWithCache } from "@/lib/cache";
import { getServerSession } from "next-auth/next";
import { authOptions, normalizeEmail } from "@/lib/auth";
import { resolveProfileImage, resolveProfileName } from "../../../lib/utils";

export const dynamic = "force-dynamic";

// Viewer-independent: the liker/session-specific shaping happens in GET, after
// this is read from cache, so the cached value is the same for every viewer.
async function loadExperienceDoc(uid) {
  const db = await getMongoDb();
  const experienceCol = db.collection("experience");
  const talesCol = db.collection("tales");

  const isObjectId = mongoose.Types.ObjectId.isValid(uid);
  const matchStage = isObjectId
    ? {
      $match: {
        $or: [{ uid }, { _id: new mongoose.Types.ObjectId(uid) }],
      },
    }
    : { $match: { uid } };

  // Fetch document and join with user info to get fresh profile image/data
  const pipeline = [
    matchStage,
    {
      $lookup: {
        from: "user",
        localField: "email",
        foreignField: "gmail",
        as: "author_info"
      }
    },
    {
      $addFields: {
        author: { $arrayElemAt: ["$author_info", 0] }
      }
    },
    {
      $project: {
        author_info: 0
      }
    }
  ];

  let results = await experienceCol.aggregate(pipeline).toArray();

  if (results.length === 0) {
    results = await talesCol.aggregate(pipeline).toArray();
  }

  return results[0] || null;
}

export async function GET(req) {
  try {
    const uid = req.nextUrl.searchParams.get("uid");

    if (!uid) {
      return NextResponse.json({ message: "Missing `uid` query parameter" }, { status: 400 });
    }

    const [data, session] = await Promise.all([
      fetchWithCache(`exp_${uid}`, 60, () => loadExperienceDoc(uid)),
      getServerSession(authOptions),
    ]);

    if (!data) {
      return NextResponse.json({ message: "Document not found" }, { status: 404 });
    }

    // Merge author info into the top level for helpers to pick it up. The raw
    // document also carries the joined `author` user doc and the `likes` array of
    // liker emails -- toPublicPost drops both. The author's own email stays: the
    // page builds /profile/public/<email> from it.
    const finalData = toPublicPost(
      {
        ...data,
        profile_pic: resolveProfileImage({ ...data, ...data.author }),
        name: resolveProfileName({ ...data, ...data.author }),
      },
      { viewerEmail: normalizeEmail(session?.user?.email), keepAuthorEmail: true }
    );

    return NextResponse.json(finalData);
  } catch (error) {
    console.error("Error fetching data:", error);
    return jsonError(error, "Unable to load experience");
  }
}
