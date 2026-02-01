import { NextResponse } from "next/server";
import { assertEnv, env } from "../../../../lib/env.js";
import { attachSessionCookie, createSession } from "../../../../lib/session.js";
import { getBaseUrlFromRequest, getDiscordRedirectUri } from "../../../../lib/runtimeUrl.js";

export const dynamic = "force-dynamic";

async function exchangeCode(code, { redirectUri }) {
  const body = new URLSearchParams({
    client_id: env.discordClientId,
    client_secret: env.discordClientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  });

  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth token error: ${response.status} ${text}`);
  }

  return response.json();
}

async function fetchUser(accessToken) {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`User fetch error: ${response.status} ${text}`);
  }

  return response.json();
}

export async function GET(request) {
  assertEnv(["discordClientId", "discordClientSecret", "sessionSecret", "mongoUri"]);

  const baseUrl = getBaseUrlFromRequest(request);
  const redirectUri = getDiscordRedirectUri({ baseUrl });

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const cookieState = request.cookies.get("oauth_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(`${baseUrl}/login?error=state`);
  }

  try {
    const token = await exchangeCode(code, { redirectUri });
    const user = await fetchUser(token.access_token);

    const sessionData = await createSession({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
      user
    });

    const response = NextResponse.redirect(`${baseUrl}/dashboard`);
    attachSessionCookie(response, sessionData.sessionId, sessionData.expiresAt);
    response.cookies.delete("oauth_state");
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.redirect(`${baseUrl}/login?error=oauth`);
  }
}
