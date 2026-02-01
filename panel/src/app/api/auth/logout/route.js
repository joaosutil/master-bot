import { NextResponse } from "next/server";
import { env } from "../../../../lib/env.js";
import {
  clearSessionCookie,
  destroySessionById,
  getSessionIdFromCookies
} from "../../../../lib/session.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionId = getSessionIdFromCookies();
  await destroySessionById(sessionId);
  const response = NextResponse.redirect(`${env.baseUrl}/login`);
  clearSessionCookie(response);
  return response;
}
