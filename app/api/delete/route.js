import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getMongoDb } from "@/lib/mongodb";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api-response";
import { invalidateAfterWrite } from "@/lib/cache";

// DELETE Handler
export async function DELETE(req) {
  // The author is the session, never the body: `email` and `uid` are both public
  // via /api/feed, so trusting the body let anyone delete anyone's post.
  const auth = await requireSession();
  if (auth.response) return auth.response;

  const limited = await checkRateLimit(req, { key: "delete-post", limit: 20, windowSeconds: 300 });
  if (limited) return limited;

  try {
    const { uid } = await req.json().catch(() => ({}));

    if (!uid) {
      return NextResponse.json({ message: "Missing required field: uid" }, { status: 400 });
    }

    const db = await getMongoDb({ mode: "write" });
    const filter = { uid, email: auth.email };

    let result = await db.collection("experience").deleteOne(filter);

    if (result.deletedCount === 0) {
      result = await db.collection("tales").deleteOne(filter);
    }

    if (result.deletedCount === 0) {
      return NextResponse.json({ message: "No matching experience found" }, { status: 404 });
    }

    await invalidateAfterWrite(auth.email, uid);

    return NextResponse.json({ message: "Experience deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("Error deleting experience:", error);
    return jsonError(error, "Unable to delete experience");
  }
}
