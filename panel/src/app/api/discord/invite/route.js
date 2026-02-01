import { NextResponse } from "next/server";
import { assertEnv, env } from "../../../../lib/env.js";

export const dynamic = "force-dynamic";

function normalizePermissions(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  return raw;
}

export async function GET(request) {
  assertEnv(["discordClientId"]);

  const { searchParams } = new URL(request.url);
  const permissions = normalizePermissions(searchParams.get("permissions")) ?? "8";
  const guildId = String(searchParams.get("guild_id") ?? "").trim();

  const params = new URLSearchParams({
    client_id: env.discordClientId,
    scope: "bot applications.commands",
    permissions
  });

  if (/^\d+$/.test(guildId)) {
    params.set("guild_id", guildId);
    params.set("disable_guild_select", "true");
  }

  return NextResponse.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
}

