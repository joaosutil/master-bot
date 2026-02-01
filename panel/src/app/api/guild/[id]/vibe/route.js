import { NextResponse } from "next/server";
import { connectDb } from "../../../../../lib/db.js";
import { fetchDiscord, hasManageGuild } from "../../../../../lib/discord.js";
import { env } from "../../../../../lib/env.js";
import { getBaseUrlFromRequest } from "../../../../../lib/runtimeUrl.js";
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

function parseHour(value) {
  const n = Number(String(value ?? "").trim());
  if (!Number.isFinite(n)) return 20;
  const clamped = Math.max(0, Math.min(23, Math.floor(n)));
  return clamped;
}

const DEFAULT_OPTIONS = [
  { id: "top", emoji: "😄", label: "Tô no 220v" },
  { id: "deboa", emoji: "🙂", label: "De boa" },
  { id: "cansado", emoji: "😴", label: "Cansado" },
  { id: "estressado", emoji: "😡", label: "Estressado" }
];

function readOptions(form) {
  return DEFAULT_OPTIONS.map((opt, index) => {
    const emoji = toOptionalString(form.get(`opt${index + 1}Emoji`)) || opt.emoji;
    const label = toOptionalString(form.get(`opt${index + 1}Label`)) || opt.label;
    return { id: opt.id, emoji: emoji.slice(0, 24), label: label.slice(0, 80) };
  });
}

export async function POST(request, { params }) {
  const baseUrl = getBaseUrlFromRequest(request);
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(`${baseUrl}/login`);
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
    return NextResponse.redirect(`${baseUrl}/dashboard`);
  }

  const form = await request.formData();
  const enabled = parseBoolean(form.get("enabled"));
  const channelId = toOptionalString(form.get("channelId"));
  const hour = parseHour(form.get("hour"));
  const question = toOptionalString(form.get("question"));
  const options = readOptions(form);

  if (enabled && !channelId) {
    return NextResponse.redirect(`${baseUrl}/guild/${guildId}/vibe?error=missing_channel`);
  }

  await connectDb();
  const config = await getOrCreateGuildConfig(guildId);
  if (!config.vibeCheck) config.vibeCheck = {};

  config.vibeCheck.enabled = enabled;
  config.vibeCheck.channelId = channelId;
  config.vibeCheck.hour = hour;
  config.vibeCheck.question = question;
  config.vibeCheck.options = options;

  config.markModified("vibeCheck");
  await config.save();

  return NextResponse.redirect(`${baseUrl}/guild/${guildId}/vibe?saved=1`);
}
