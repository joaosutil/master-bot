import { NextResponse } from "next/server";
import { connectDb } from "../../../../../../lib/db.js";
import { fetchDiscord, fetchDiscordBot, hasManageGuild } from "../../../../../../lib/discord.js";
import { env, assertEnv } from "../../../../../../lib/env.js";
import { getBaseUrlFromRequest } from "../../../../../../lib/runtimeUrl.js";
import { getSession } from "../../../../../../lib/session.js";
import { getOrCreateGuildConfig } from "../../../../../../lib/guildConfig.js";

export const dynamic = "force-dynamic";

function normalizeHex(value) {
  const raw = String(value ?? "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return raw.toLowerCase();
}

function buildPayload(config) {
  const panel = config?.panel ?? {};
  const title = String(panel.title ?? "").trim() || "✅ Verificação";
  const description =
    String(panel.description ?? "").trim() ||
    "Clique no botão abaixo para se verificar e liberar o servidor.";
  const buttonLabel = String(panel.buttonLabel ?? "").trim() || "Verificar";
  const footerText =
    String(panel.footerText ?? "").trim() || "Master Bot • Verificação rápida";
  const hex = normalizeHex(panel.color);
  const color = hex ? Number.parseInt(hex, 16) : 0x2fffe0;

  return {
    embeds: [
      {
        title: title.slice(0, 256),
        description: description.slice(0, 3900),
        color,
        footer: { text: footerText.slice(0, 2048) }
      }
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            custom_id: "verify_start",
            label: buttonLabel.slice(0, 80)
          }
        ]
      }
    ]
  };
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
  const channelId = String(form.get("channelId") ?? "").trim();
  const pinned = String(form.get("pinned") ?? "false") === "true";

  if (!channelId) {
    return NextResponse.redirect(
      `${baseUrl}/guild/${guildId}/verification?error=channel_required`
    );
  }

  await connectDb();
  const config = await getOrCreateGuildConfig(guildId);
  const verification = config.verification ? config.verification.toObject() : {};

  if (!verification?.roleId) {
    return NextResponse.redirect(
      `${baseUrl}/guild/${guildId}/verification?error=role_required`
    );
  }

  // opcional: ao publicar, sincroniza o canal salvo na config para evitar divergência
  if (!config.verification) config.verification = {};
  config.verification.channelId = channelId;

  const payload = buildPayload(verification);

  let finalMessageId = verification.messageId;

  try {
    if (verification.messageId && verification.channelId === channelId) {
      await fetchDiscordBot(`/channels/${channelId}/messages/${verification.messageId}`, {
        botToken: env.discordBotToken,
        method: "PATCH",
        body: payload
      });
    } else {
      const message = await fetchDiscordBot(`/channels/${channelId}/messages`, {
        botToken: env.discordBotToken,
        method: "POST",
        body: payload
      });
      finalMessageId = message.id;
    }

    if (pinned && finalMessageId) {
      await fetchDiscordBot(`/channels/${channelId}/pins/${finalMessageId}`, {
        botToken: env.discordBotToken,
        method: "PUT"
      });
    }
  } catch (error) {
    console.error(error);
    return NextResponse.redirect(
      `${baseUrl}/guild/${guildId}/verification?error=publish_failed`
    );
  }

  if (!config.verification) config.verification = {};
  config.verification.enabled = true;
  config.verification.messageId = finalMessageId;
  config.markModified("verification");
  await config.save();

  return NextResponse.redirect(`${baseUrl}/guild/${guildId}/verification?panel=1`);
}
