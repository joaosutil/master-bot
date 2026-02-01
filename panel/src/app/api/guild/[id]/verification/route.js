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

function parseBoolean(value) {
  const raw = String(value ?? "").toLowerCase().trim();
  return raw === "true" || raw === "on" || raw === "1" || raw === "yes";
}

function normalizeHex(value) {
  const raw = String(value ?? "").trim().replace("#", "");
  if (!raw) return undefined;
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return undefined;
  return `#${raw.toLowerCase()}`;
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
  const roleId = toOptionalString(form.get("roleId"));
  const removeRoleId = toOptionalString(form.get("removeRoleId"));
  const title = toOptionalString(form.get("panelTitle"));
  const description = toOptionalString(form.get("panelDescription"));
  const buttonLabel = toOptionalString(form.get("panelButtonLabel"));
  const footerText = toOptionalString(form.get("panelFooterText"));
  const color = normalizeHex(form.get("panelColor"));
  const captchaDifficulty = String(form.get("captchaDifficulty") ?? "").trim();

  if (enabled && (!channelId || !roleId)) {
    return NextResponse.redirect(
      `${env.baseUrl}/guild/${guildId}/verification?error=missing_fields`
    );
  }
  if (removeRoleId && roleId && removeRoleId === roleId) {
    return NextResponse.redirect(
      `${env.baseUrl}/guild/${guildId}/verification?error=remove_equals_role`
    );
  }

  await connectDb();
  const config = await getOrCreateGuildConfig(guildId);
  if (!config.verification) config.verification = {};

  const prevChannelId = config.verification.channelId ?? null;
  const prevRoleId = config.verification.roleId ?? null;

  config.verification.enabled = enabled;
  config.verification.channelId = channelId;
  config.verification.roleId = roleId;
  config.verification.removeRoleId = removeRoleId;
  if (!config.verification.panel) config.verification.panel = {};
  config.verification.panel.title = title;
  config.verification.panel.description = description;
  config.verification.panel.buttonLabel = buttonLabel;
  config.verification.panel.footerText = footerText;
  config.verification.panel.color = color;
  if (!config.verification.captcha) config.verification.captcha = {};
  config.verification.captcha.difficulty =
    captchaDifficulty === "easy" || captchaDifficulty === "hard"
      ? captchaDifficulty
      : "medium";

  // se trocar canal/cargo, mantemos a mensagem salva, mas o publish pode recriar se necessario
  if (!enabled) {
    config.verification.messageId = undefined;
  } else if (prevChannelId !== channelId || prevRoleId !== roleId) {
    // deixa messageId como está; não destrói automaticamente para evitar perda de referência
  }

  config.markModified("verification");
  await config.save();

  const paramsOut = new URLSearchParams();
  paramsOut.set("saved", "1");
  return NextResponse.redirect(
    `${env.baseUrl}/guild/${guildId}/verification?${paramsOut.toString()}`
  );
}
