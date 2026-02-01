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

function toBoolean(value) {
  const raw = String(value ?? "").toLowerCase();
  return raw === "true" || raw === "on" || raw === "1";
}

function toNumber(value, fallback, { min, max } = {}) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (Number.isNaN(parsed)) return fallback;
  if (typeof min === "number" && parsed < min) return min;
  if (typeof max === "number" && parsed > max) return max;
  return parsed;
}

function unique(values) {
  return Array.from(new Set(values));
}

function parseWords(value) {
  if (!value) return [];
  return unique(
    String(value)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
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

  const logChannelId = toOptionalString(form.get("logChannelId"));

  const automodEnabled = toBoolean(form.get("automodEnabled"));

  const antiFloodEnabled = toBoolean(form.get("antiFloodEnabled"));
  const antiFloodMaxMessages = toNumber(form.get("antiFloodMaxMessages"), 6, {
    min: 2,
    max: 25
  });
  const antiFloodIntervalSeconds = toNumber(
    form.get("antiFloodIntervalSeconds"),
    8,
    { min: 2, max: 60 }
  );
  const antiFloodTimeoutMinutes = toNumber(
    form.get("antiFloodTimeoutMinutes"),
    2,
    { min: 0, max: 10080 }
  );
  const antiFloodDeleteMessages = toBoolean(form.get("antiFloodDeleteMessages"));

  const antiSpamEnabled = toBoolean(form.get("antiSpamEnabled"));
  const antiSpamMaxDuplicates = toNumber(form.get("antiSpamMaxDuplicates"), 3, {
    min: 2,
    max: 15
  });
  const antiSpamIntervalSeconds = toNumber(
    form.get("antiSpamIntervalSeconds"),
    10,
    { min: 3, max: 60 }
  );
  const antiSpamTimeoutMinutes = toNumber(
    form.get("antiSpamTimeoutMinutes"),
    2,
    { min: 0, max: 10080 }
  );
  const antiSpamDeleteMessages = toBoolean(form.get("antiSpamDeleteMessages"));

  const antiLinkEnabled = toBoolean(form.get("antiLinkEnabled"));
  const antiLinkTimeoutMinutes = toNumber(
    form.get("antiLinkTimeoutMinutes"),
    0,
    { min: 0, max: 10080 }
  );
  const antiLinkDeleteMessages = toBoolean(form.get("antiLinkDeleteMessages"));
  const antiLinkAllowedRoleIds = unique(
    form.getAll("antiLinkAllowedRoleIds").map((value) => String(value))
  );
  const antiLinkAllowedChannelIds = unique(
    form.getAll("antiLinkAllowedChannelIds").map((value) => String(value))
  );

  const wordFilterEnabled = toBoolean(form.get("wordFilterEnabled"));
  const wordFilterWords = parseWords(form.get("wordFilterWords"));
  const wordFilterTimeoutMinutes = toNumber(
    form.get("wordFilterTimeoutMinutes"),
    0,
    { min: 0, max: 10080 }
  );
  const wordFilterDeleteMessages = toBoolean(form.get("wordFilterDeleteMessages"));

  const raidEnabled = toBoolean(form.get("raidEnabled"));
  const raidMaxJoins = toNumber(form.get("raidMaxJoins"), 6, {
    min: 2,
    max: 50
  });
  const raidIntervalSeconds = toNumber(form.get("raidIntervalSeconds"), 12, {
    min: 3,
    max: 120
  });

  await connectDb();
  const config = await getOrCreateGuildConfig(guildId);
  if (!config.moderation) config.moderation = {};
  if (!config.moderation.automod) config.moderation.automod = {};

  config.moderation.logChannelId = logChannelId;
  config.moderation.automod.enabled = automodEnabled;
  config.moderation.automod.antiFlood = {
    enabled: antiFloodEnabled,
    maxMessages: antiFloodMaxMessages,
    intervalSeconds: antiFloodIntervalSeconds,
    timeoutMinutes: antiFloodTimeoutMinutes,
    deleteMessages: antiFloodDeleteMessages
  };
  config.moderation.automod.antiSpam = {
    enabled: antiSpamEnabled,
    maxDuplicates: antiSpamMaxDuplicates,
    intervalSeconds: antiSpamIntervalSeconds,
    timeoutMinutes: antiSpamTimeoutMinutes,
    deleteMessages: antiSpamDeleteMessages
  };
  config.moderation.automod.antiLink = {
    enabled: antiLinkEnabled,
    allowedRoleIds: antiLinkAllowedRoleIds,
    allowedChannelIds: antiLinkAllowedChannelIds,
    timeoutMinutes: antiLinkTimeoutMinutes,
    deleteMessages: antiLinkDeleteMessages
  };
  config.moderation.automod.wordFilter = {
    enabled: wordFilterEnabled,
    words: wordFilterWords,
    timeoutMinutes: wordFilterTimeoutMinutes,
    deleteMessages: wordFilterDeleteMessages
  };
  config.moderation.automod.raidDetection = {
    enabled: raidEnabled,
    maxJoins: raidMaxJoins,
    intervalSeconds: raidIntervalSeconds
  };

  config.markModified("moderation");
  await config.save();

  const paramsOut = new URLSearchParams();
  paramsOut.set("saved", "1");
  return NextResponse.redirect(
    `${env.baseUrl}/guild/${guildId}/moderation?${paramsOut.toString()}`
  );
}
