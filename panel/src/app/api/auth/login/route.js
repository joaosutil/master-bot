import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { assertEnv, env } from "../../../../lib/env.js";

export async function GET() {
  assertEnv(["discordClientId", "discordClientSecret", "discordRedirectUri"]);

  const state = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: env.discordClientId,
    redirect_uri: env.discordRedirectUri,
    response_type: "code",
    scope: "identify guilds",
    state
  });

  const response = NextResponse.redirect(
    `https://discord.com/api/oauth2/authorize?${params}`
  );

  response.cookies.set("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 300
  });

  return response;
}
