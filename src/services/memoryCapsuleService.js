import crypto from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import MemoryCapsuleEntry from "../models/MemoryCapsuleEntry.js";
import { getGuildConfigLean, saveGuildConfigDoc } from "./guildConfigService.js";

const SCHEDULER_STARTED = "_mbMemoryCapsuleSchedulerStarted";
const MIN_INTERVAL_MS = 10 * 60 * 1000;

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed)) return fallback;
  if (typeof min === "number" && parsed < min) return min;
  if (typeof max === "number" && parsed > max) return max;
  return parsed;
}

function normalizeId(value) {
  const v = String(value ?? "").trim();
  return /^\d+$/.test(v) ? v : "";
}

export function parseDiscordMessageLink(url) {
  const text = String(url ?? "").trim();
  const m = text.match(
    /(?:https?:\/\/)?(?:canary\.|ptb\.)?discord\.com\/channels\/(?<guildId>\d+)\/(?<channelId>\d+)\/(?<messageId>\d+)/i
  );
  if (!m?.groups) return null;
  return {
    guildId: m.groups.guildId,
    channelId: m.groups.channelId,
    messageId: m.groups.messageId
  };
}

function getMemoryConfig(configDoc) {
  const raw = configDoc?.memoryCapsule ?? {};
  const enabled = Boolean(raw.enabled);
  const channelId = raw.channelId ? String(raw.channelId) : "";
  const cadence = raw.cadence === "weekly" ? "weekly" : "daily";
  const hour = clampInt(raw.hour, 20, 0, 23);
  const lastPostedAt = raw.lastPostedAt ? new Date(raw.lastPostedAt) : null;
  return { enabled, channelId, cadence, hour, lastPostedAt };
}

function hasManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function nextDueAt({ cadence, hour, lastPostedAt }) {
  const now = new Date();
  const base = lastPostedAt ? new Date(lastPostedAt) : null;

  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(hour);

  // se ainda nao passou do horario de hoje, hoje; senao, amanha/semana que vem
  if (now > next) {
    next.setDate(next.getDate() + (cadence === "weekly" ? 7 : 1));
  }

  // se nunca postou, permite hoje no horario; se ja postou muito recente, pula
  if (!base) return next;

  const minNext = new Date(base.getTime() + (cadence === "weekly" ? 7 : 1) * 24 * 60 * 60 * 1000);
  if (next < minNext) return minNext;
  return next;
}

function truncate(text, max = 900) {
  const value = String(text ?? "");
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "…";
}

export function buildMemoryModal() {
  const modal = new ModalBuilder()
    .setCustomId("memory_capsule_add")
    .setTitle("Cápsula do tempo");

  const link = new TextInputBuilder()
    .setCustomId("messageLink")
    .setLabel("Link da mensagem (discord.com/channels/...)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  const note = new TextInputBuilder()
    .setCustomId("note")
    .setLabel("Nota (opcional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(400);

  modal.addComponents(
    new ActionRowBuilder().addComponents(link),
    new ActionRowBuilder().addComponents(note)
  );

  return modal;
}

export async function handleMemoryAdd(interaction) {
  await interaction.showModal(buildMemoryModal());
}

export async function handleMemoryAddModalSubmit(interaction) {
  const messageLink = interaction.fields.getTextInputValue("messageLink");
  const note = interaction.fields.getTextInputValue("note")?.trim() ?? "";
  const parsed = parseDiscordMessageLink(messageLink);

  if (!parsed) {
    await interaction.reply({
      content: "Link inválido. Use o link de mensagem do Discord (discord.com/channels/...).",
      ephemeral: true
    });
    return;
  }

  if (parsed.guildId !== String(interaction.guildId)) {
    await interaction.reply({
      content: "Esse link é de outro servidor.",
      ephemeral: true
    });
    return;
  }

  const channelId = normalizeId(parsed.channelId);
  const messageId = normalizeId(parsed.messageId);
  if (!channelId || !messageId) {
    await interaction.reply({ content: "Link inválido.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased?.()) {
    await interaction.editReply("Não consegui acessar o canal dessa mensagem.");
    return;
  }

  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) {
    await interaction.editReply("Não consegui buscar essa mensagem (talvez apagada ou sem permissão).");
    return;
  }

  const url = `https://discord.com/channels/${parsed.guildId}/${channelId}/${messageId}`;
  const content = truncate(msg.content ?? "", 1200);
  const authorId = msg.author?.id ?? null;

  try {
    await MemoryCapsuleEntry.create({
      guildId: interaction.guildId,
      channelId,
      messageId,
      messageUrl: url,
      authorId,
      content,
      note: note || undefined
    });
  } catch (error) {
    if (error?.code === 11000) {
      await interaction.editReply("Essa memória já está salva.");
      return;
    }
    throw error;
  }

  await interaction.editReply("Memória salva! Ela pode aparecer na cápsula automática depois.");
}

export async function setMemoryConfig(interaction, updates) {
  if (!hasManageGuild(interaction)) {
    await interaction.reply({ content: "Você precisa de Manage Guild.", ephemeral: true });
    return;
  }

  const doc = await GuildConfig.findOne({ guildId: interaction.guildId });
  const configDoc = doc ?? new GuildConfig({ guildId: interaction.guildId });
  if (!configDoc.memoryCapsule) configDoc.memoryCapsule = {};

  if (typeof updates.enabled === "boolean") configDoc.memoryCapsule.enabled = updates.enabled;
  if (typeof updates.channelId === "string") configDoc.memoryCapsule.channelId = updates.channelId || undefined;
  if (updates.cadence === "daily" || updates.cadence === "weekly") configDoc.memoryCapsule.cadence = updates.cadence;
  if (typeof updates.hour === "number") configDoc.memoryCapsule.hour = clampInt(updates.hour, 20, 0, 23);

  await saveGuildConfigDoc(configDoc);

  await interaction.reply({
    content: "Configuração da cápsula salva.",
    ephemeral: true
  });
}

function buildMemoryEmbed({ entry, guild }) {
  const embed = new EmbedBuilder()
    .setTitle("📼 Cápsula do tempo")
    .setColor(0x2fffe0)
    .setDescription(
      [
        entry.content ? `“${truncate(entry.content, 800)}”` : null,
        entry.note ? `\n📝 ${truncate(entry.note, 250)}` : null
      ]
        .filter(Boolean)
        .join("")
    )
    .addFields(
      { name: "Canal", value: `<#${entry.channelId}>`, inline: true },
      { name: "Autor", value: entry.authorId ? `<@${entry.authorId}>` : "desconhecido", inline: true }
    )
    .setFooter({ text: "Guarde boas memórias. Faça novas também." });

  if (guild?.name) {
    embed.setAuthor({ name: guild.name });
  }

  return embed;
}

export async function postRandomMemory({ client, guildId, force = false } = {}) {
  const configDoc = await getGuildConfigLean(guildId).catch(() => null);
  const cfg = getMemoryConfig(configDoc);
  if (!cfg.enabled && !force) return { ok: false, reason: "disabled" };
  if (!cfg.channelId) return { ok: false, reason: "no_channel" };

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { ok: false, reason: "guild_missing" };

  const target = await guild.channels.fetch(cfg.channelId).catch(() => null);
  if (!target || !target.isTextBased?.()) return { ok: false, reason: "channel_missing" };

  const entry = await MemoryCapsuleEntry.aggregate([
    { $match: { guildId: String(guildId) } },
    { $addFields: { usedSort: { $ifNull: ["$usedAt", new Date(0)] } } },
    { $sort: { usedSort: 1, createdAt: -1 } },
    { $limit: 50 },
    { $sample: { size: 1 } }
  ]).then((rows) => rows?.[0] ?? null);

  if (!entry) return { ok: false, reason: "no_entries" };

  const embed = buildMemoryEmbed({ entry, guild });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Abrir mensagem").setURL(entry.messageUrl)
  );

  await target.send({ embeds: [embed], components: [row] });

  await MemoryCapsuleEntry.updateOne(
    { _id: entry._id },
    { $set: { usedAt: new Date() } }
  );

  // salva lastPostedAt
  const doc = await GuildConfig.findOne({ guildId: String(guildId) });
  const configToSave = doc ?? new GuildConfig({ guildId: String(guildId) });
  if (!configToSave.memoryCapsule) configToSave.memoryCapsule = {};
  configToSave.memoryCapsule.lastPostedAt = new Date();
  await saveGuildConfigDoc(configToSave);

  return { ok: true };
}

export function startMemoryCapsuleScheduler(client) {
  if (!client || global[SCHEDULER_STARTED]) return;
  global[SCHEDULER_STARTED] = true;

  const tick = async () => {
    if (!client?.isReady?.()) return;

    for (const guild of client.guilds.cache.values()) {
      const configDoc = await getGuildConfigLean(guild.id).catch(() => null);
      const cfg = getMemoryConfig(configDoc);
      if (!cfg.enabled || !cfg.channelId) continue;

      const dueAt = nextDueAt(cfg);
      if (Date.now() < dueAt.getTime()) continue;

      try {
        await postRandomMemory({ client, guildId: guild.id, force: true });
      } catch (error) {
        console.warn("Memory capsule post failed:", error);
      }
    }
  };

  const timer = setInterval(tick, MIN_INTERVAL_MS);
  timer.unref?.();
}

export async function ensureMemoryChannel(interaction, channel) {
  if (!channel) return "";
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    await interaction.reply({ content: "Escolha um canal de texto.", ephemeral: true });
    return "";
  }
  return channel.id;
}
