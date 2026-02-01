import { NextResponse } from "next/server";
import { connectDb } from "../../../../../../lib/db.js";
import { fetchDiscord, hasManageGuild, fetchDiscordBot } from "../../../../../../lib/discord.js";
import { env, assertEnv } from "../../../../../../lib/env.js";
import { getBaseUrlFromRequest } from "../../../../../../lib/runtimeUrl.js";
import { getSession } from "../../../../../../lib/session.js";
import { getOrCreateGuildConfig } from "../../../../../../lib/guildConfig.js";

export const dynamic = "force-dynamic";

const DEFAULT_CATEGORY = {
  label: "Geral",
  description: "Suporte geral"
};

function buildComponents(categories) {
  const options = categories.slice(0, 25).map((category) => ({
    label: category.label.slice(0, 100),
    description: category.description?.slice(0, 100),
    value: category.label.slice(0, 100)
  }));

  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: "ticket_category:public",
          placeholder: "Escolha a categoria",
          min_values: 1,
          max_values: 1,
          options
        }
      ]
    }
  ];
}

function normalizeHex(value) {
  const raw = String(value ?? "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return raw.toLowerCase();
}

function applyVariables(text, guild) {
  if (!text) return text;
  const date = new Date().toLocaleDateString("pt-BR");
  return text
    .replaceAll("{server}", guild?.name ?? "")
    .replaceAll("{serverId}", guild?.id ?? "")
    .replaceAll("{date}", date);
}

function buildEmbeds(payload) {
  const embed = {
    title: payload.title,
    description: payload.description,
    color: payload.color ?? 0x5865f2
  };

  if (payload.footerText) {
    embed.footer = { text: payload.footerText };
  }

  if (payload.thumbnailUrl) {
    embed.thumbnail = { url: payload.thumbnailUrl };
  }

  if (payload.imageUrl) {
    embed.image = { url: payload.imageUrl };
  }

  if (payload.authorName) {
    embed.author = payload.authorIconUrl
      ? { name: payload.authorName, icon_url: payload.authorIconUrl }
      : { name: payload.authorName };
  }

  return [embed];
}

export async function POST(request, { params }) {
  assertEnv(["discordBotToken"]);
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
  const panelChannelId = String(form.get("panelChannelId") ?? "").trim();
  const panelTitle = String(form.get("panelTitle") ?? "Abrir ticket").trim();
  const panelDescription = String(form.get("panelDescription") ?? "").trim();
  const panelColorRaw = String(form.get("panelColor") ?? "").trim();
  const panelFooterText = String(form.get("panelFooterText") ?? "").trim();
  const panelThumbnailUrl = String(form.get("panelThumbnailUrl") ?? "").trim();
  const panelImageUrl = String(form.get("panelImageUrl") ?? "").trim();
  const panelAuthorName = String(form.get("panelAuthorName") ?? "").trim();
  const panelAuthorIconUrl = String(form.get("panelAuthorIconUrl") ?? "").trim();
  const panelPinned = String(form.get("panelPinned") ?? "false") === "true";

  if (!panelChannelId) {
    return NextResponse.redirect(
      `${baseUrl}/guild/${guildId}/tickets?error=panel_channel`
    );
  }

  await connectDb();
  const config = await getOrCreateGuildConfig(guildId);

  if (!config.tickets) config.tickets = {};
  if (!config.tickets.panel) config.tickets.panel = {};

  const categories = config.tickets.categories?.length
    ? config.tickets.categories
    : [DEFAULT_CATEGORY];

  let guildInfo = null;
  try {
    guildInfo = await fetchDiscordBot(`/guilds/${guildId}`, {
      botToken: env.discordBotToken
    });
  } catch (error) {
    console.warn("Falha ao carregar dados da guild:", error);
  }

  const colorHex = normalizeHex(panelColorRaw);
  const colorValue = colorHex ? Number.parseInt(colorHex, 16) : null;
  const titleWithVars = applyVariables(panelTitle, guildInfo);
  const descriptionWithVars = applyVariables(
    panelDescription || "Selecione a categoria abaixo.",
    guildInfo
  );
  const footerWithVars = applyVariables(panelFooterText, guildInfo);
  const authorWithVars = applyVariables(panelAuthorName, guildInfo);

  const payload = {
    embeds: buildEmbeds({
      title: titleWithVars,
      description: descriptionWithVars,
      color: colorValue ?? 0x5865f2,
      footerText: footerWithVars || undefined,
      thumbnailUrl: panelThumbnailUrl || undefined,
      imageUrl: panelImageUrl || undefined,
      authorName: authorWithVars || undefined,
      authorIconUrl: panelAuthorIconUrl || undefined
    }),
    components: buildComponents(categories)
  };

  let messageId = config.tickets.panel.panelMessageId;
  let finalMessageId = messageId;

  try {
    if (messageId && config.tickets.panel.panelChannelId === panelChannelId) {
      await fetchDiscordBot(`/channels/${panelChannelId}/messages/${messageId}`, {
        botToken: env.discordBotToken,
        method: "PATCH",
        body: payload
      });
    } else {
      const message = await fetchDiscordBot(`/channels/${panelChannelId}/messages`, {
        botToken: env.discordBotToken,
        method: "POST",
        body: payload
      });
      finalMessageId = message.id;
    }

    if (panelPinned && finalMessageId) {
      await fetchDiscordBot(`/channels/${panelChannelId}/pins/${finalMessageId}`, {
        botToken: env.discordBotToken,
        method: "PUT"
      });
    }
  } catch (error) {
    console.error(error);
    return NextResponse.redirect(`${baseUrl}/guild/${guildId}/tickets?error=panel_publish`);
  }

  config.tickets.panel.panelChannelId = panelChannelId;
  config.tickets.panel.panelMessageId = finalMessageId;
  config.tickets.panel.panelTitle = panelTitle;
  config.tickets.panel.panelDescription = panelDescription;
  config.tickets.panel.panelPinned = panelPinned;
  config.tickets.panel.panelColor = colorHex ? `#${colorHex}` : undefined;
  config.tickets.panel.panelFooterText = panelFooterText || undefined;
  config.tickets.panel.panelThumbnailUrl = panelThumbnailUrl || undefined;
  config.tickets.panel.panelImageUrl = panelImageUrl || undefined;
  config.tickets.panel.panelAuthorName = panelAuthorName || undefined;
  config.tickets.panel.panelAuthorIconUrl = panelAuthorIconUrl || undefined;

  await config.save();

  return NextResponse.redirect(`${baseUrl}/guild/${guildId}/tickets?panel=1`);
}
