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

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed)) return fallback;
  if (typeof min === "number" && parsed < min) return min;
  if (typeof max === "number" && parsed > max) return max;
  return parsed;
}

function parseCategories(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, description, template] = line.split("|");
      return {
        label: (label ?? "").trim(),
        description: description ? description.trim() : undefined,
        template: template ? template.trim() : undefined,
        questions: []
      };
    })
    .filter((cat) => cat.label.length)
    .slice(0, 25);
}

function parseCategoriesJson(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(String(raw));
    if (!Array.isArray(data)) return null;
    return data
      .map((item) => ({
        label: String(item?.label ?? "").trim(),
        description: String(item?.description ?? "").trim() || undefined,
        template: String(item?.template ?? "").trim() || undefined,
        questions: Array.isArray(item?.questions)
          ? item.questions
              .map((question) => String(question ?? "").trim())
              .filter(Boolean)
              .slice(0, 5)
          : []
      }))
      .filter((cat) => cat.label.length)
      .slice(0, 25);
  } catch (error) {
    console.warn("Falha ao ler categorias JSON:", error);
    return null;
  }
}

function parseIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((value) => value.trim())
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
  const type = form.get("type") === "channel" ? "channel" : "thread";
  const openChannelId = toOptionalString(form.get("openChannelId"));
  const formResponseTemplate = toOptionalString(form.get("formResponseTemplate"));
  const autoCloseEnabled = parseBoolean(form.get("autoCloseEnabled"));
  const autoCloseAfterMinutes = clampInt(form.get("autoCloseAfterMinutes"), 0, 0, 60 * 24 * 30);
  let autoCloseReminderMinutes = clampInt(form.get("autoCloseReminderMinutes"), 0, 0, 60 * 24 * 30);
  if (!autoCloseEnabled || autoCloseAfterMinutes <= 0) {
    autoCloseReminderMinutes = 0;
  } else if (autoCloseReminderMinutes >= autoCloseAfterMinutes) {
    autoCloseReminderMinutes = 0;
  }
  const staffRoleValues = form.getAll("staffRoleIds");
  const staffRoleIdsRaw =
    staffRoleValues.length > 1
      ? staffRoleValues.map((value) => String(value).trim()).filter(Boolean)
      : parseIds(form.get("staffRoleIds"));
  const staffRoleIds = Array.from(new Set(staffRoleIdsRaw));
  const categories =
    parseCategoriesJson(form.get("categoriesJson")) ??
    parseCategories(form.get("categories"));

  await connectDb();
  const config = await getOrCreateGuildConfig(guildId);

  if (!config.tickets) config.tickets = {};
  config.tickets.type = type;
  config.tickets.openChannelId = openChannelId;
  config.tickets.categoryChannelId = undefined;
  config.tickets.formResponseTemplate = formResponseTemplate;
  config.tickets.autoClose = {
    enabled: autoCloseEnabled && autoCloseAfterMinutes > 0,
    afterMinutes: autoCloseEnabled ? autoCloseAfterMinutes : 0,
    reminderMinutes: autoCloseReminderMinutes
  };
  config.tickets.staffRoleIds = staffRoleIds;
  config.tickets.categories = categories;

  await config.save();

  const paramsOut = new URLSearchParams();
  paramsOut.set("saved", "1");
  return NextResponse.redirect(
    `${env.baseUrl}/guild/${guildId}/tickets?${paramsOut.toString()}`
  );
}
