import { NextResponse } from "next/server";
import { getMongoDb } from "@/lib/mongodb";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rate-limit";
import {
    MAX_SHORT_FIELD,
    normalizeCategory,
    normalizeShortText,
    normalizeTags,
    validateExpText,
} from "@/lib/post-input";
import { invalidateAfterWrite } from "@/lib/cache";

const SHORT_TEXT_FIELDS = ["company", "college", "branch", "batch", "role", "title"];

export async function PUT(req) {
    const auth = await requireSession();
    if (auth.response) return auth.response;

    const limited = await checkRateLimit(req, { key: "edit", limit: 30, windowSeconds: 300 });
    if (limited) return limited;

    try {
        const body = await req.json().catch(() => ({}));
        const { uid } = body;

        if (!uid) {
            return NextResponse.json({ message: "Missing required field: uid" }, { status: 400 });
        }

        if (typeof uid !== "string") {
            return NextResponse.json({ message: "Missing required field: uid" }, { status: 400 });
        }

        // Only set what the client actually sent. Spreading every destructured field
        // wrote `undefined` -> null and silently wiped company/college/branch/batch/role
        // on a partial edit. Every value is normalized with the same rules the
        // create path uses -- an edit must not be able to bypass them.
        const $set = { updated_at: new Date().toString() };

        for (const field of SHORT_TEXT_FIELDS) {
            if (body[field] !== undefined) $set[field] = normalizeShortText(body[field], MAX_SHORT_FIELD);
        }

        if (body.exp_text !== undefined) {
            const invalid = validateExpText(body.exp_text);
            if (invalid) return NextResponse.json({ message: invalid }, { status: 400 });
            $set.exp_text = body.exp_text;
        }

        if (body.tags !== undefined) $set.tags = normalizeTags(body.tags);

        if (body.category !== undefined) {
            $set.category = normalizeCategory(body.category, true);
        }

        const db = await getMongoDb({ mode: "write" });
        const filter = { uid, email: auth.email };

        // Tales live in their own collection; editing a story used to always 404.
        let result = await db.collection("experience").updateOne(filter, { $set });

        if (result.matchedCount === 0) {
            result = await db.collection("tales").updateOne(filter, { $set });
        }

        if (result.matchedCount === 0) {
            return NextResponse.json({ message: "No matching experience found" }, { status: 404 });
        }

        await invalidateAfterWrite(auth.email, uid);

        return NextResponse.json({ message: "Experience updated successfully", uid }, { status: 200 });
    } catch (error) {
        console.error("Error updating experience:", error);
        return jsonError(error, "Unable to update experience");
    }
}
