import crypto from "node:crypto";
import { cookies } from "next/headers";
import { connectDb } from "./db.js";
import Session from "../models/Session.js";

const SESSION_COOKIE = "mb_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 6;

export function createSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

export async function createSession({
  accessToken,
  refreshToken,
  expiresIn,
  user
}) {
  await connectDb();

  const sessionId = createSessionId();
  const expiresAt = new Date(Date.now() + (expiresIn ? expiresIn * 1000 : SESSION_TTL_MS));

  await Session.create({
    sessionId,
    accessToken,
    refreshToken,
    expiresAt,
    userId: user?.id ?? "unknown",
    userName: user?.username,
    userAvatar: user?.avatar
  });

  return { sessionId, expiresAt };
}

export async function getSession() {
  await connectDb();
  const cookieStore = cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const session = await Session.findOne({ sessionId });
  if (!session) return null;

  if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
    await Session.deleteOne({ sessionId });
    cookieStore.delete(SESSION_COOKIE);
    return null;
  }

  return session;
}

export function attachSessionCookie(response, sessionId, expiresAt) {
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt
  });
}

export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0)
  });
}

export async function destroySessionById(sessionId) {
  if (!sessionId) return;
  await connectDb();
  await Session.deleteOne({ sessionId });
}

export function getSessionIdFromCookies() {
  const cookieStore = cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}
