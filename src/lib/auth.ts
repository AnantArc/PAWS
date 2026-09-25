import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

/**
 * SESSION PLUMBING
 * ----------------
 * Local mode   : stateless HMAC-signed cookie (seeded demo users below).
 * Supabase mode: Supabase Auth session cookie set by /api/auth/signin.
 * The rest of the app only ever sees { name, email, role }.
 */

export type Role = "operator" | "observer";

export interface SessionUser {
  name: string;
  email: string;
  role: Role;
  mode: "local" | "supabase";
  /** The PAWS robot this operator is driving (selected at login). */
  robotId: string;
}

export const DEMO_ROBOTS: Array<{ id: string; name: string }> = [{ id: "paws-01", name: "PAWS Alpha" }];
export const DEFAULT_ROBOT_ID = "paws-01";

export const DEMO_USERS: Array<{ name: string; email: string; password: string; role: Role }> = [
  { name: "PAWS Operator", email: "operator@paws.local", password: "paws-demo-operator", role: "operator" },
  { name: "PAWS Observer", email: "observer@paws.local", password: "paws-demo-observer", role: "observer" },
];

const SECRET = () => process.env.AUTH_SECRET ?? "paws-dev-secret-change-me";
const SESSION_COOKIE = "paws_session";
const FIELD_TOKEN_TTL = 4 * 60 * 60 * 1000; // 4 h

// ------------------------------------------------------------- local token
function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

function signPayload(payload: object): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", SECRET()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyPayload<T>(token: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", SECRET()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

export function signSession(user: SessionUser): string {
  return signPayload({ ...user, exp: Date.now() + 12 * 60 * 60 * 1000 });
}

export function verifySession(token: string): SessionUser | null {
  const p = verifyPayload<SessionUser & { exp: number }>(token);
  if (!p || p.exp < Date.now()) return null;
  return { name: p.name, email: p.email, role: p.role, mode: p.mode, robotId: p.robotId ?? DEFAULT_ROBOT_ID };
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

export function readSessionFromCookies(): SessionUser | null {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export function readSessionFromRequest(req: NextRequest): SessionUser | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

// ---------------------------------------------------------- field tokens
export function signFieldToken(missionId: string): string {
  return signPayload({ scope: "field", missionId, exp: Date.now() + FIELD_TOKEN_TTL });
}

export function verifyFieldToken(token: string): { missionId: string } | null {
  const p = verifyPayload<{ scope: string; missionId: string; exp: number }>(token);
  if (!p || p.scope !== "field" || p.exp < Date.now()) return null;
  return { missionId: p.missionId };
}

// ------------------------------------------------------------- supabase
export function mode(): "local" | "supabase" {
  return process.env.DATA_MODE === "supabase" ? "supabase" : "local";
}

/** Role is carried in the Supabase user metadata (set at signup; see schema.sql). */
export function roleFromSupabase(user: { user_metadata?: Record<string, unknown> }): Role {
  return user.user_metadata?.role === "operator" ? "operator" : "observer";
}
