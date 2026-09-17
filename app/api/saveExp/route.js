import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import slugify from "slugify";
import { companySlugFromName } from "@/lib/companySlug";
import nodemailer from "nodemailer";
import { getMongoDb } from "@/lib/mongodb";
import { normalizeCategory, normalizeShortText, normalizeTags, validateExpText } from "@/lib/post-input";
import { requireSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { escapeHtml } from "@/lib/utils";
import { jsonError } from "@/lib/api-response";
import { invalidateAfterWrite } from "@/lib/cache";

export async function POST(req) {
  // Unauthenticated post creation let anyone publish as another user -- and was
  // the delivery vector for stored XSS via exp_text.
  const auth = await requireSession();
  if (auth.response) return auth.response;

  const limited = await checkRateLimit(req, { key: "saveExp", limit: 10, windowSeconds: 300 });
  if (limited) return limited;

  try {
    const { exp_text, college, company, branch, batch, role, content_type, title, tags, category } = await req.json().catch(() => ({}));

    // Author identity always comes from the session.
    const email = auth.email;
    const name = auth.name || email.split("@")[0];
    const profile_pic = auth.image || "";

    // For interviews, company and name are required.
    // For tales, title and name are required.
    const isTale = content_type === "tale";
    const normalizedTags = normalizeTags(tags);
    const normalizedCategory = normalizeCategory(category, isTale);

    // Short fields were stored verbatim: a non-string `company` broke the feed's
    // equality filter and made slugify() throw further down.
    const safeCompany = normalizeShortText(company);
    const safeCollege = normalizeShortText(college);
    const safeBranch = normalizeShortText(branch);
    const safeBatch = normalizeShortText(batch);
    const safeRole = normalizeShortText(role);
    const safeTitle = normalizeShortText(title);

    const invalidText = validateExpText(exp_text);
    if (invalidText) return NextResponse.json({ message: invalidText }, { status: 400 });
    if (!isTale && !safeCompany) return NextResponse.json({ message: "Company is required for interview experiences" }, { status: 400 });
    if (isTale && !safeTitle) return NextResponse.json({ message: "Title is required for stories" }, { status: 400 });

    const db = await getMongoDb({ mode: "write" });
    const collectionName = isTale ? "tales" : "experience";
    const experience = db.collection(collectionName);
    const backupName = isTale ? "tales_backup" : "backup";
    const backup = db.collection(backupName);

    // Generate a meaningful UID
    let baseSlug;
    if (isTale) {
      baseSlug = slugify(`${safeTitle} by ${name}`, { lower: true, strict: true });
    } else {
      baseSlug = slugify(`${name}'s experience at ${safeCompany} ${safeRole} ${safeBatch} `, { lower: true, strict: true });
    }

    let uid = `${baseSlug}-${nanoid(6)}`; // Append a short unique ID

    // Ensure UID uniqueness across BOTH collections: /single/[uid] resolves against
    // experience first and then tales, so a shared uid would shadow one of them.
    const talesCol = db.collection("tales");
    const experienceCol = db.collection("experience");
    while (
      (await experienceCol.findOne({ uid }, { projection: { _id: 1 } })) ||
      (await talesCol.findOne({ uid }, { projection: { _id: 1 } }))
    ) {
      uid = `${baseSlug}-${nanoid(6)}`;
    }

    // Save experience to DB
    const now = new Date().toISOString();
    const doc = {
      uid,
      exp_text,
      college: safeCollege,
      company: isTale ? safeCollege : safeCompany,
      branch: safeBranch,
      batch: safeBatch,
      profile_pic,
      name,
      date: now,
      views: 0,
      role: isTale ? "" : safeRole,
      email,
      content_type: content_type === "tale" ? "tale" : "interview",
      title: safeTitle,
      tags: normalizedTags,
      category: normalizedCategory,
    };

    const result = await experience.insertOne(doc);

    // The mirror write must never fail the request: it used to 500 *after* the
    // primary insert succeeded, so the client retried and created a duplicate post.
    backup.insertOne(doc).catch((err) =>
      console.warn("[backup] insert failed:", err?.message || err)
    );

    // Sync with Company collection only for interviews
    if (!isTale) {
      try {
        const companySlug = companySlugFromName(safeCompany);
        await db.collection("companies").updateOne(
          { name: safeCompany },
          {
            $inc: { "stats.interviewsCount": 1 },
            $setOnInsert: {
              slug: companySlug,
              about: `Company ${safeCompany} interview experience details.`,
              tags: ["Interview"],
              "stats.reviewsCount": 0,
              "stats.rating": 5
            }
          },
          { upsert: true }
        );
      } catch (companyError) {
        console.error("Failed to sync company state:", companyError);
        // Non-blocking error
      }
    }

    if (!result.acknowledged) {
      return NextResponse.json({ message: "Failed to save experience" }, { status: 500 });
    }

    await invalidateAfterWrite(email);

    // Fire-and-forget: awaiting a Gmail SMTP handshake made post creation
    // time out on the client for something the user never sees.
    const siteUrl = req.nextUrl?.origin || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    sendAcknowledgmentEmail(name, email, uid, siteUrl);

    return NextResponse.json({ message: "Experience saved successfully", uid }, { status: 200 });
  } catch (error) {
    console.error("Error saving experience:", error);
    return jsonError(error, "Unable to save experience");
  }
}

async function sendAcknowledgmentEmail(name, email, uid, siteUrl) {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  if (!emailUser || !emailPass) {
    console.warn("Email skipped: EMAIL_USER/EMAIL_PASS are not configured.");
    return;
  }

  try {
    const postUrl = `${siteUrl}/single/${uid}`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    });

    const mailOptions = {
      from: emailUser,
      to: email,
      subject: "🌟 Thank You for Sharing Your Experience! 🌟",
      html: `
        <p>Hello ${escapeHtml(name)},</p>
        <p>We truly appreciate you for taking the time to share your interview experience on our platform! 🙌</p>
        <p>Your insights will be incredibly helpful for the next batch of candidates preparing for their placements.</p>
        <p>Here’s your post: <a href="${postUrl}" target="_blank">${postUrl}</a></p>
        <p>You can edit or delete your post anytime to keep it updated!</p>
        <br>
        <p>Best Regards,</p>
        <p><strong>theInterview Team</strong></p>
      `,
    };


    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.warn("Failed to send acknowledgment email:", error?.code || error?.message || error);
  }
}
