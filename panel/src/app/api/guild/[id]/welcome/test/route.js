import { NextResponse } from "next/server";
import {
  fetchDiscord,
  fetchDiscordBot,
  hasManageGuild
} from "../../../../../../lib/discord.js";
import { assertEnv, env } from "../../../../../../lib/env.js";
import { getSession } from "../../../../../../lib/session.js";

export const dynamic = "force-dynamic";

function toOptionalString(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length ? trimmed : undefined;
}

function normalizeHex(value) {
  const raw = String(value ?? "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return raw.toLowerCase();
}

function clipText(value, maxLen) {
  const text = String(value ?? "");
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

function applyVariables(text, ctx) {
  if (!text) return "";
  const date = new Date().toLocaleDateString("pt-BR");
  return String(text)
    .replaceAll("{user}", ctx.userMention ?? "")
    .replaceAll("{username}", ctx.username ?? "")
    .replaceAll("{userTag}", ctx.userTag ?? "")
    .replaceAll("{server}", ctx.serverName ?? "")
    .replaceAll("{memberCount}", ctx.memberCount ?? "")
    .replaceAll("{date}", date)
    .trim();
}

function buildWelcomeEmbed(config, ctx) {
  const title =
    applyVariables(config.title, ctx) || `Bem-vindo(a), ${ctx.username || "membro"}!`;
  const description =
    applyVariables(config.description, ctx) || "Sinta-se em casa no servidor.";

  const colorHex = normalizeHex(config.color);
  const embed = {
    title: clipText(title, 256),
    description: clipText(description, 4096),
    color: colorHex ? Number.parseInt(colorHex, 16) : 0x2fffe0
  };

  const footerText = applyVariables(config.footerText, ctx);
  if (footerText) {
    embed.footer = { text: clipText(footerText, 2048) };
  }

  if (config.thumbnailUrl) {
    embed.thumbnail = { url: String(config.thumbnailUrl) };
  }

  if (config.imageUrl) {
    embed.image = { url: String(config.imageUrl) };
  }

  const authorName = applyVariables(config.authorName, ctx);
  if (authorName) {
    embed.author = config.authorIconUrl
      ? { name: clipText(authorName, 256), icon_url: String(config.authorIconUrl) }
      : { name: clipText(authorName, 256) };
  }

  return embed;
}

export async function POST(request, { params }) {
  assertEnv(["discordBotToken"]);

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const guildId = params.id;

  let guilds = [];
  try {
    guilds = await fetchDiscord("/users/@me/guilds", {
      token: session.accessToken
    });
  } catch (error) {
    console.error(error);
    if (error?.status === 429) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: error.retryAfter ?? 1 },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: "discord_fetch_failed" }, { status: 500 });
  }

  const guild = guilds.find((g) => g.id === guildId) ?? null;
  const allowed = Boolean(guild && hasManageGuild(guild.permissions));
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const channelId = toOptionalString(body?.channelId);
  if (!channelId) {
    return NextResponse.json({ error: "channel_required" }, { status: 400 });
  }

  const config = {
    title: toOptionalString(body?.title),
    description: toOptionalString(body?.description),
    color: toOptionalString(body?.color),
    footerText: toOptionalString(body?.footerText),
    thumbnailUrl: toOptionalString(body?.thumbnailUrl),
    imageUrl: toOptionalString(body?.imageUrl),
    authorName: toOptionalString(body?.authorName),
    authorIconUrl: toOptionalString(body?.authorIconUrl)
  };

  let me = null;
  try {
    me = await fetchDiscord("/users/@me", { token: session.accessToken });
  } catch {}

  let guildDetail = null;
  try {
    guildDetail = await fetchDiscordBot(`/guilds/${guildId}?with_counts=true`, {
      botToken: env.discordBotToken
    });
  } catch {}

  let channel = null;
  try {
    channel = await fetchDiscordBot(`/channels/${channelId}`, {
      botToken: env.discordBotToken
    });
  } catch (error) {
    console.error(error);
    if (error?.status === 429) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: error.retryAfter ?? 1 },
        { status: 429 }
      );
    }
    if (error?.status === 403) {
      return NextResponse.json({ error: "missing_permissions" }, { status: 403 });
    }
    if (error?.status === 404) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "channel_fetch_failed" }, { status: 500 });
  }

  if (!channel || String(channel.guild_id ?? "") !== String(guildId)) {
    return NextResponse.json({ error: "channel_not_in_guild" }, { status: 400 });
  }

  const channelType = Number(channel.type);
  if (![0, 5].includes(channelType)) {
    return NextResponse.json({ error: "channel_not_text" }, { status: 400 });
  }

  const username = me?.username ?? session.userName ?? "";
  const userTag =
    me?.tag ??
    (me?.discriminator && String(me.discriminator) !== "0"
      ? `${me.username}#${me.discriminator}`
      : username);

  const memberCount =
    String(guildDetail?.approximate_member_count ?? guildDetail?.member_count ?? "") || "";

  const rawUserId = String(session.userId ?? "");
  const isUserId = /^\d+$/.test(rawUserId);

  const ctx = {
    userMention: isUserId ? `<@${rawUserId}>` : "",
    username,
    userTag,
    serverName: guildDetail?.name ?? guild?.name ?? "",
    memberCount
  };

  const embed = buildWelcomeEmbed(config, ctx);

  const allowedMentions = isUserId
    ? { parse: ["users"], users: [rawUserId] }
    : { parse: [] };

  try {
    const sent = await fetchDiscordBot(`/channels/${channelId}/messages`, {
      botToken: env.discordBotToken,
      method: "POST",
      body: {
        embeds: [embed],
        allowed_mentions: allowedMentions
      }
    });

    return NextResponse.json({ ok: true, messageId: sent?.id ?? null });
  } catch (error) {
    console.error(error);
    if (error?.status === 429) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: error.retryAfter ?? 1 },
        { status: 429 }
      );
    }
    if (error?.status === 403) {
      return NextResponse.json({ error: "missing_permissions" }, { status: 403 });
    }
    if (error?.status === 404) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }
}
