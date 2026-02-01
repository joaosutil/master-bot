import { NextResponse } from "next/server";
import { connectDb } from "../../../../../lib/db.js";
import { fetchDiscord, hasManageGuild } from "../../../../../lib/discord.js";
import { env } from "../../../../../lib/env.js";
import { getSession } from "../../../../../lib/session.js";
import { getOrCreateGuildConfig } from "../../../../../lib/guildConfig.js";

function toOptionalString(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length ? trimmed : undefined;
}

function normalizeIdList(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
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
  const enabled =
    String(form.get("enabled") ?? "").toLowerCase() === "true" ||
    String(form.get("enabled") ?? "").toLowerCase() === "on";
  const channelId = toOptionalString(form.get("channelId"));
  const title = toOptionalString(form.get("title"));
  const description = toOptionalString(form.get("description"));
  const color = toOptionalString(form.get("color"));
  const footerText = toOptionalString(form.get("footerText"));
  const thumbnailUrl = toOptionalString(form.get("thumbnailUrl"));
  const imageUrl = toOptionalString(form.get("imageUrl"));
  const authorName = toOptionalString(form.get("authorName"));
  const authorIconUrl = toOptionalString(form.get("authorIconUrl"));
  const autoRoleIds = normalizeIdList(form.getAll("autoRoleIds"));

  if (enabled && !channelId) {
    return NextResponse.redirect(
      `${env.baseUrl}/guild/${guildId}/welcome?error=channel_required`
    );
  }

  await connectDb();
  const config = await getOrCreateGuildConfig(guildId);
  if (!config.welcome) config.welcome = {};

  config.welcome.enabled = enabled;
  config.welcome.channelId = channelId;
  config.welcome.title = title;
  config.welcome.description = description;
  config.welcome.color = color;
  config.welcome.footerText = footerText;
  config.welcome.thumbnailUrl = thumbnailUrl;
  config.welcome.imageUrl = imageUrl;
  config.welcome.authorName = authorName;
  config.welcome.authorIconUrl = authorIconUrl;
  config.welcome.autoRoleIds = autoRoleIds;
  config.markModified("welcome");

  await config.save();

  const paramsOut = new URLSearchParams();
  paramsOut.set("saved", "1");
  return NextResponse.redirect(
    `${env.baseUrl}/guild/${guildId}/welcome?${paramsOut.toString()}`
  );
}
