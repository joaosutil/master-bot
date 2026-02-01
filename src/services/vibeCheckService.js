import mongoose from "mongoose";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";

import VibeCheckDay from "../models/VibeCheckDay.js";
import {
  getGuildConfigLean,
  getOrCreateGuildConfigDoc,
  saveGuildConfigDoc
} from "./guildConfigService.js";

const DEFAULT_OPTIONS = [
  { id: "top", emoji: "😄", label: "Tô no 220v" },
  { id: "deboa", emoji: "🙂", label: "De boa" },
  { id: "cansado", emoji: "😴", label: "Cansado" },
  { id: "estressado", emoji: "😡", label: "Estressado" }
];

const BUTTON_STYLES = [
  ButtonStyle.Success,
  ButtonStyle.Primary,
  ButtonStyle.Secondary,
  ButtonStyle.Danger
];

function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeOptions(options) {
  const raw = Array.isArray(options) ? options : [];
  const cleaned = raw
    .map((o) => ({
      id: String(o?.id ?? "").trim(),
      emoji: String(o?.emoji ?? "").trim(),
      label: String(o?.label ?? "").trim()
    }))
    .filter((o) => o.id && o.label);

  const unique = [];
  const seen = new Set();
  for (const opt of cleaned) {
    if (seen.has(opt.id)) continue;
    seen.add(opt.id);
    unique.push({
      ...opt,
      emoji: opt.emoji || "✨"
    });
  }

  if (unique.length >= 4) return unique.slice(0, 4);
  const fallback = DEFAULT_OPTIONS.filter((o) => !seen.has(o.id));
  return [...unique, ...fallback].slice(0, 4);
}

function getCount(counts, key) {
  if (!counts) return 0;
  if (typeof counts.get === "function") return Number(counts.get(key) ?? 0) || 0;
  return Number(counts[key] ?? 0) || 0;
}

function setCount(counts, key, value) {
  const v = Math.max(0, Number(value) || 0);
  if (typeof counts.set === "function") counts.set(key, v);
  else counts[key] = v;
}

function buildVibeEmbed({ dateKey, question, options, counts }) {
  const total = options.reduce((acc, opt) => acc + getCount(counts, opt.id), 0);

  const lines = options.map((opt) => {
    const count = getCount(counts, opt.id);
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `${opt.emoji} **${opt.label}** — **${count}** (${pct}%)`;
  });

  const d = new Date(`${dateKey}T00:00:00.000Z`);
  const pretty = d.toLocaleDateString("pt-BR", { timeZone: "UTC" });

  const title = "🧭 Vibe Check da Comunidade";
  const desc = `${question || "Como tá a vibe hoje?"}\n\n${lines.join("\n")}\n\n` +
    "Clique em um botão para votar. Você pode mudar seu voto quando quiser.";

  return new EmbedBuilder()
    .setTitle(title)
    .setColor("#22c55e")
    .setDescription(desc)
    .setFooter({ text: `Data (UTC): ${pretty} • Total de votos: ${total}` });
}

function buildVibeButtons({ guildId, dateKey, options }) {
  const row = new ActionRowBuilder();
  options.forEach((opt, index) => {
    const style = BUTTON_STYLES[index] ?? ButtonStyle.Secondary;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`vibe_vote:${guildId}:${dateKey}:${opt.id}`)
        .setStyle(style)
        .setLabel(opt.label.slice(0, 80))
        .setEmoji(opt.emoji || "✨")
    );
  });
  return row;
}

function pickTwin(responses, optionId, userId) {
  if (!responses) return null;
  const entries = typeof responses.entries === "function"
    ? Array.from(responses.entries())
    : Object.entries(responses);

  const pool = entries
    .filter(([uid, opt]) => uid && uid !== userId && opt === optionId)
    .map(([uid]) => uid);

  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function missionFor(optionId) {
  const missions = {
    top: [
      "Puxa alguém pro papo: mande um meme e marque 1 amigo.",
      "Começa um mini-thread: qual foi a melhor coisa do seu dia?"
    ],
    deboa: [
      "Pergunta do dia: qual música combina com a vibe de agora?",
      "Manda uma foto/print de algo que te deixou de boa hoje."
    ],
    cansado: [
      "Pausa rápida: manda uma mensagem gentil pra alguém do server.",
      "Dropa um 'meme de sono' e marca um parceiro de cochilo."
    ],
    estressado: [
      "Respira 10s e manda: o que te ajudaria agora? (sem pressão)",
      "Joga pro server: 'me recomendem algo pra relaxar'."
    ]
  };
  const list = missions[optionId] || missions.deboa;
  return list[Math.floor(Math.random() * list.length)];
}

async function ensureTodayDoc({ guildId, dateKey, channelId, messageId, config }) {
  const vibe = config?.vibeCheck || {};
  const options = normalizeOptions(vibe.options);
  const question = String(vibe.question || "").trim() || "Como tá a vibe hoje?";

  const doc = await VibeCheckDay.findOne({ guildId, dateKey });
  if (doc) {
    if (!doc.channelId && channelId) doc.channelId = channelId;
    if (!doc.messageId && messageId) doc.messageId = messageId;
    if (!doc.question) doc.question = question;
    if (!doc.options?.length) doc.options = options;
    if (!doc.counts) doc.counts = {};
    if (!doc.responses) doc.responses = {};
    await doc.save();
    return doc;
  }

  const counts = {};
  for (const opt of options) counts[opt.id] = 0;

  return await VibeCheckDay.create({
    guildId,
    dateKey,
    channelId,
    messageId,
    question,
    options,
    counts,
    responses: {}
  });
}

export async function postVibeCheckNow(client, guildId, { channelIdOverride } = {}) {
  const config = await getOrCreateGuildConfigDoc(guildId);
  if (!config.vibeCheck) config.vibeCheck = {};

  const channelId = String(channelIdOverride || config.vibeCheck.channelId || "").trim();
  if (!channelId) {
    throw new Error("vibeCheck.channelId is not configured");
  }

  config.vibeCheck.enabled = true;
  config.vibeCheck.channelId = channelId;
  if (typeof config.vibeCheck.hour !== "number") config.vibeCheck.hour = 20;
  if (!config.vibeCheck.question) config.vibeCheck.question = "Como tá a vibe hoje?";
  if (!Array.isArray(config.vibeCheck.options) || !config.vibeCheck.options.length) {
    config.vibeCheck.options = DEFAULT_OPTIONS;
  }

  await saveGuildConfigDoc(config);

  const dateKey = utcDateKey();
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    throw new Error("Configured vibe channel is not text-based or is not accessible");
  }

  const options = normalizeOptions(config.vibeCheck.options);
  const counts = {};
  for (const opt of options) counts[opt.id] = 0;

  const embed = buildVibeEmbed({
    dateKey,
    question: config.vibeCheck.question,
    options,
    counts
  });

  const row = buildVibeButtons({ guildId, dateKey, options });
  const message = await channel.send({ embeds: [embed], components: [row] });

  await ensureTodayDoc({
    guildId,
    dateKey,
    channelId: channel.id,
    messageId: message.id,
    config
  });

  return { dateKey, channelId: channel.id, messageId: message.id };
}

export async function handleVibeVote(interaction) {
  const parts = String(interaction.customId || "").split(":");
  if (parts.length < 4 || parts[0] !== "vibe_vote") return;

  const guildId = parts[1];
  const dateKey = parts[2];
  const optionId = parts[3];

  if (!interaction.guildId || interaction.guildId !== guildId) {
    return interaction.reply({ content: "Esse botão não é deste servidor.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const cfg = await getGuildConfigLean(guildId);
  const vibe = cfg?.vibeCheck || {};
  if (!vibe.enabled) {
    return interaction.editReply("Vibe Check está desativado neste servidor.");
  }

  const options = normalizeOptions(vibe.options);
  const allowed = new Set(options.map((o) => o.id));
  if (!allowed.has(optionId)) {
    return interaction.editReply("Essa opção não existe mais. Peça para o staff republicar a mensagem.");
  }

  const userId = interaction.user.id;

  const session = await mongoose.startSession();
  session.startTransaction();
  let doc;
  try {
    doc = await VibeCheckDay.findOne({ guildId, dateKey }).session(session);
    if (!doc) {
      const counts = {};
      for (const opt of options) counts[opt.id] = 0;
      doc = new VibeCheckDay({
        guildId,
        dateKey,
        channelId: interaction.channelId,
        messageId: interaction.message?.id,
        question: String(vibe.question || "").trim() || "Como tá a vibe hoje?",
        options,
        counts,
        responses: {}
      });
    } else {
      if (!doc.options?.length) doc.options = options;
      if (!doc.question) doc.question = String(vibe.question || "").trim() || "Como tá a vibe hoje?";
      if (!doc.channelId) doc.channelId = interaction.channelId;
      if (!doc.messageId && interaction.message?.id) doc.messageId = interaction.message.id;
      if (!doc.counts) doc.counts = {};
      if (!doc.responses) doc.responses = {};
    }

    const prev = typeof doc.responses.get === "function" ? doc.responses.get(userId) : doc.responses[userId];

    if (prev === optionId) {
      await session.abortTransaction();
      session.endSession();
      const twin = pickTwin(doc.responses, optionId, userId);
      const opt = doc.options.find((o) => o.id === optionId);
      const msg = [
        `Você já está com **${opt?.label ?? optionId}** ${opt?.emoji ?? ""}.`,
        `Mini missão: ${missionFor(optionId)}`,
        twin ? `Seu gêmeo de vibe hoje: <@${twin}>` : "Você é o(a) pioneiro(a) dessa vibe hoje."
      ].join("\n");
      return interaction.editReply(msg);
    }

    if (prev && allowed.has(prev)) {
      setCount(doc.counts, prev, getCount(doc.counts, prev) - 1);
    }
    setCount(doc.counts, optionId, getCount(doc.counts, optionId) + 1);

    if (typeof doc.responses.set === "function") doc.responses.set(userId, optionId);
    else doc.responses[userId] = optionId;

    await doc.save({ session });
    await session.commitTransaction();
  } catch (error) {
    try {
      await session.abortTransaction();
    } catch {}
    throw error;
  } finally {
    session.endSession();
  }

  try {
    const embed = buildVibeEmbed({
      dateKey,
      question: doc.question,
      options: doc.options?.length ? doc.options : options,
      counts: doc.counts
    });
    const row = buildVibeButtons({
      guildId,
      dateKey,
      options: doc.options?.length ? doc.options : options
    });
    await interaction.message.edit({ embeds: [embed], components: [row] });
  } catch {}

  const twin = pickTwin(doc.responses, optionId, userId);
  const opt = (doc.options || options).find((o) => o.id === optionId);
  const reply = [
    `Voto registrado: **${opt?.label ?? optionId}** ${opt?.emoji ?? ""}`,
    `Mini missão: ${missionFor(optionId)}`,
    twin ? `Seu gêmeo de vibe hoje: <@${twin}>` : "Você é o(a) pioneiro(a) dessa vibe hoje."
  ].join("\n");

  return interaction.editReply(reply);
}

export function startVibeCheckScheduler(client) {
  const intervalMs = 60_000;
  const timer = setInterval(async () => {
    const now = new Date();
    const dateKey = utcDateKey(now);
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();

    for (const [guildId] of client.guilds.cache) {
      try {
        const cfg = await getGuildConfigLean(guildId);
        const vibe = cfg?.vibeCheck;
        if (!vibe?.enabled) continue;

        const scheduledHour = Number(vibe.hour);
        if (!Number.isFinite(scheduledHour)) continue;
        if (hour !== scheduledHour) continue;
        if (minute > 10) continue;

        if (!vibe.channelId) continue;

        const existing = await VibeCheckDay.findOne({ guildId, dateKey })
          .select({ _id: 1, messageId: 1 })
          .lean();

        if (existing?.messageId) continue;

        await postVibeCheckNow(client, guildId, { channelIdOverride: vibe.channelId });
      } catch (error) {
        console.warn(`Vibe scheduler error (${guildId}):`, error?.message || error);
      }
    }
  }, intervalMs);

  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

