import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

const isDev = process.env.NODE_ENV === "development";

const AUTH_SECRET =
  process.env.NEXTAUTH_SECRET ||
  process.env.AUTH_SECRET ||
  (isDev ? "local-dev-auth-secret-change-me" : undefined);

// Fail at boot rather than at request time: a missing secret silently turns every
// authenticated route into a 401 with nothing in the logs to explain why.
// Skipped during `next build`, which imports this module to collect page data:
// the Cloud Run image is built without auth secrets, which arrive at runtime.
if (!isDev && process.env.NEXT_PHASE !== "phase-production-build") {
  const missing = [
    !AUTH_SECRET && "NEXTAUTH_SECRET",
    !process.env.GOOGLE_CLIENT_ID && "GOOGLE_CLIENT_ID",
    !process.env.GOOGLE_CLIENT_SECRET && "GOOGLE_CLIENT_SECRET",
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(`Auth misconfigured: missing ${missing.join(", ")}`);
  }
}

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      httpOptions: {
        timeout: 10000,
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      if (account) {
        token.id = user.id || account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) {
        session.user.id = token.id;
      }
      return session;
    },
  },
  secret: AUTH_SECRET,
};

export const authHandler = NextAuth(authOptions);

/** Emails are compared against stored values, so normalize once here. */
export function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/**
 * Resolve the caller's session. Returns { session, email, name, image } on success,
 * or { response } holding a 401 the route should return as-is.
 *
 * Every mutating route must take the acting identity from here and never from the
 * request body -- the body is attacker-controlled.
 */
export async function requireSession() {
  const session = await getServerSession(authOptions);
  const email = normalizeEmail(session?.user?.email);

  if (!email) {
    return {
      response: NextResponse.json(
        { success: false, error: "Authentication required", code: "UNAUTHENTICATED" },
        { status: 401 }
      ),
    };
  }

  return {
    session,
    email,
    name: session.user.name || "",
    image: session.user.image || "",
  };
}
