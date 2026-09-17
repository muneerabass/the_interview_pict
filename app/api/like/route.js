import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getMongoDb } from "@/lib/mongodb";
import { requireSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError } from "@/lib/api-response";
import { invalidateAfterWrite } from "@/lib/cache";

export async function POST(req) {
    // Liking as an arbitrary body-supplied email let anyone like on someone else's
    // behalf and inflate counts.
    const auth = await requireSession();
    if (auth.response) return auth.response;

    const limited = await checkRateLimit(req, { key: "like", limit: 60, windowSeconds: 60 });
    if (limited) return limited;

    try {
        const { id } = await req.json().catch(() => ({}));

        // typeof, not truthiness: {"id":{"$gt":""}} made the filter an operator
        // expression that matched the first post in natural order, so a caller
        // could like a post they never named.
        if (typeof id !== "string" || !id.trim()) {
            return NextResponse.json({ success: false, error: "Missing required fields", code: "VALIDATION_ERROR" }, { status: 400 });
        }

        const db = await getMongoDb({ mode: "write" });
        const email = auth.email;

        const updatePipeline = [
            {
                $set: {
                    likes: {
                        $cond: [
                            { $in: [email, { $ifNull: ["$likes", []] }] },
                            { $setDifference: ["$likes", [email]] },
                            { $concatArrays: [{ $ifNull: ["$likes", []] }, [email]] }
                        ]
                    },
                    likesUpdatedAt: new Date(),
                }
            }
        ];

        let result = await db.collection("experience").findOneAndUpdate(
            { uid: id },
            updatePipeline,
            { returnDocument: "after", projection: { likes: 1, email: 1 } }
        );

        if (!result) {
            result = await db.collection("tales").findOneAndUpdate(
                { uid: id },
                updatePipeline,
                { returnDocument: "after", projection: { likes: 1, email: 1 } }
            );
        }

        if (!result) {
            return NextResponse.json({ success: false, error: "Post not found" }, { status: 404 });
        }

        const likes = Array.isArray(result.likes) ? result.likes : [];

        await invalidateAfterWrite(result.email, id);

        revalidatePath("/feed");
        revalidatePath(`/single/${id}`);

        return NextResponse.json(
            { success: true, count: likes.length, liked: likes.includes(email) },
            { status: 200 }
        );
    } catch (error) {
        console.error("Error toggling like:", error);
        return jsonError(error, "Unable to update like");
    }
}
