import { NextResponse } from "next/server";
import { getBaseUrlFromRequest } from "../../../../lib/runtimeUrl.js";
import {
  clearSessionCookie,
  destroySessionById,
  getSessionIdFromCookies
} from "../../../../lib/session.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const baseUrl = getBaseUrlFromRequest(request);
  const sessionId = getSessionIdFromCookies();
  await destroySessionById(sessionId);
  const response = NextResponse.redirect(`${baseUrl}/login`);
  clearSessionCookie(response);
  return response;
}
