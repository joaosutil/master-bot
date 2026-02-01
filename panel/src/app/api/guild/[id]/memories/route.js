import { NextResponse } from "next/server";
import { connectDb } from "../../../../../lib/db.js";
import { fetchDiscord, hasManageGuild } from "../../../../../lib/discord.js";
import { env } from "../../../../../lib/env.js";
import { getSession } from "../../../../../lib/session.js";
import { getOrCreateGuildConfig } from "../../../../../lib/guildConfig.js";

export const dynamic = "force-dynamic";

function toOptionalString(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length ? trimmed : undefined;
}

function parseBoolean(value) {
  const raw = String(value ?? "").toLowerCase().trim();
  return raw === "true" || raw === "on" || raw === "1" || raw === "yes";
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed)) return fallback;
  if (typeof min === "number" && parsed < min) return min;
  if (typeof max === "number" && parsed > max) return max;
  return parsed;
}

export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(`${env.baseUrl}/login`);
  }

  const guildId = params.id;

  let guilds = [];
  try {
    guilds = await fetchDiscord("/users/@me/guilds", {
      token: session.accessToken
    });
  } catch (error) {
    console.error(error);
  }

  const allowed = guilds.some(
    (guild) => guild.id === guildId && hasManageGuild(guild.permissions)
  );

  if (!allowed) {
    return NextResponse.redirect(`${env.baseUrl}/dashboard`);
  }

  const form = await request.formData();
  const enabled = parseBoolean(form.get("enabled"));
  const channelId = toOptionalString(form.get("channelId"));
  const cadence = form.get("cadence") === "daily" ? "daily" : "weekly";
  const hour = clampInt(form.get("hour"), 20, 0, 23);

  await connectDb();
  const config = await getOrCreateGuildConfig(guildId);
  if (!config.memoryCapsule) config.memoryCapsule = {};

  config.memoryCapsule.enabled = enabled;
  config.memoryCapsule.channelId = channelId;
  config.memoryCapsule.cadence = cadence;
  config.memoryCapsule.hour = hour;
  config.markModified("memoryCapsule");

  await config.save();

  const paramsOut = new URLSearchParams();
  paramsOut.set("saved", "1");
  return NextResponse.redirect(
    `${env.baseUrl}/guild/${guildId}/memories?${paramsOut.toString()}`
  );
}
