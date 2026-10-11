import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

// Admin login for the Settings page and Ishaan's decisions (map steps 1 and 14).
// One shared password (ADMIN_PASSWORD). After login, a signed cookie proves it for 30 days.
// The cookie holds an expiry time and a signature, never the password itself.

const COOKIE = "admin_session";
const MAX_AGE_SEC = 30 * 24 * 3600;

const sign = (expires: number) =>
  createHmac("sha256", env("ADMIN_PASSWORD")).update(`admin-session:v1:${expires}`).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passwordMatches(input: string): boolean {
  return safeEqual(input, env("ADMIN_PASSWORD"));
}

export async function startSession(): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  (await cookies()).set(COOKIE, `${expires}.${sign(expires)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return false;
  const [exp, sig] = value.split(".");
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires < Date.now() / 1000 || !sig) return false;
  return safeEqual(sig, sign(expires));
}
