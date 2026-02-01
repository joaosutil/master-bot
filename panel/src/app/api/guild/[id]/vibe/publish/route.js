import { NextResponse } from "next/server";
import { connectDb } from "../../../../../../lib/db.js";
import { fetchDiscord, fetchDiscordBot, hasManageGuild } from "../../../../../../lib/discord.js";
import { env, assertEnv } from "../../../../../../lib/env.js";
import { getSession } from "../../../../../../lib/session.js";
import { getOrCreateGuildConfig } from "../../../../../../lib/guildConfig.js";
import VibeCheckDay from "../../../../../../models/VibeCheckDay.js";

export const dynamic = "force-dynamic";

const DEFAULT_OPTIONS = [
  { id: "top", emoji: "😄", label: "Tô no 220v" },
  { id: "deboa", emoji: "🙂", label: "De boa" },
  { id: "cansado", emoji: "😴", label: "Cansado" },
  { id: "estressado", emoji: "😡", label: "Estressado" }
];

function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function buildPayload({ guildId, dateKey, question, options }) {
  const q = String(question ?? "").trim() || "Como tá a vibe hoje?";
  const list = options
    .slice(0, 4)
    .map((o) => `${o.emoji || "✨"} **${o.label || o.id}** — **0** (0%)`)
    .join("\n");

  const d = new Date(`${dateKey}T00:00:00.000Z`);
  const pretty = d.toLocaleDateString("pt-BR", { timeZone: "UTC" });

  return {
    embeds: [
      {
        title: "🧭 Vibe Check da Comunidade",
        description:
          `${q}\n\n${list}\n\n` +
          "Clique em um botão para votar. Você pode mudar seu voto quando quiser.",
        color: 0x22c55e,
        footer: { text: `Data (UTC): ${pretty} • Total de votos: 0` }
      }
    ],
    components: [
      {
        type: 1,
        components: options.slice(0, 4).map((opt, index) => ({
          type: 2,
          style: [3, 1, 2, 4][index] ?? 2,
          custom_id: `vibe_vote:${guildId}:${dateKey}:${opt.id}`,
          label: String(opt.label || opt.id).slice(0, 80),
          emoji: opt.emoji ? { name: opt.emoji } : undefined
        }))
      }
    ]
  };
}

export async function POST(request, { params }) {
  assertEnv(["discordBotToken"]);

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
  const channelId = String(form.get("channelId") ?? "").trim();
  const pinned = String(form.get("pinned") ?? "false") === "true";

  if (!channelId) {
    return NextResponse.redirect(`${env.baseUrl}/guild/${guildId}/vibe?error=channel_required`);
  }

  await connectDb();
  const config = await getOrCreateGuildConfig(guildId);
  const vibe = config.vibeCheck ? config.vibeCheck.toObject() : {};

  const dateKey = utcDateKey();
  const question = String(vibe.question ?? "").trim() || "Como tá a vibe hoje?";
  const options = Array.isArray(vibe.options) && vibe.options.length
    ? vibe.options
    : DEFAULT_OPTIONS;

  const payload = buildPayload({ guildId, dateKey, question, options });

  let message;
  try {
    message = await fetchDiscordBot(`/channels/${channelId}/messages`, {
      botToken: env.discordBotToken,
      method: "POST",
      body: payload
    });

    if (pinned && message?.id) {
      await fetchDiscordBot(`/channels/${channelId}/pins/${message.id}`, {
        botToken: env.discordBotToken,
        method: "PUT"
      });
    }
  } catch (error) {
    console.error(error);
    return NextResponse.redirect(`${env.baseUrl}/guild/${guildId}/vibe?error=publish_failed`);
  }

  if (!config.vibeCheck) config.vibeCheck = {};
  config.vibeCheck.enabled = true;
  config.vibeCheck.channelId = channelId;
  config.markModified("vibeCheck");
  await config.save();

  const counts = {};
  for (const opt of options.slice(0, 4)) counts[String(opt.id)] = 0;

  await VibeCheckDay.findOneAndUpdate(
    { guildId, dateKey },
    {
      $set: {
        guildId,
        dateKey,
        channelId,
        messageId: message?.id,
        question,
        options: options.slice(0, 4),
        counts,
        responses: {}
      }
    },
    { upsert: true }
  );

  return NextResponse.redirect(`${env.baseUrl}/guild/${guildId}/vibe?published=1`);
}
