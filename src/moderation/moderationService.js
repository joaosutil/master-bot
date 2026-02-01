import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import Infraction from "../models/Infraction.js";

const CONFIG_TTL_MS = 30_000;
const configCache = new Map();

const DEFAULT_CONFIG = {
  logChannelId: null,
  automod: {
    enabled: false,
    antiFlood: {
      enabled: false,
      maxMessages: 6,
      intervalSeconds: 8,
      timeoutMinutes: 2,
      deleteMessages: true
    },
    antiSpam: {
      enabled: false,
      maxDuplicates: 3,
      intervalSeconds: 10,
      timeoutMinutes: 2,
      deleteMessages: true
    },
    antiLink: {
      enabled: false,
      allowedRoleIds: [],
      allowedChannelIds: [],
      timeoutMinutes: 0,
      deleteMessages: true
    },
    wordFilter: {
      enabled: false,
      words: [],
      timeoutMinutes: 0,
      deleteMessages: true
    },
    raidDetection: {
      enabled: false,
      maxJoins: 6,
      intervalSeconds: 12
    }
  }
};

const messageBuckets = new Map();
const joinBuckets = new Map();
const raidAlertAt = new Map();

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return fallback;
  if (typeof min === "number" && parsed < min) return min;
  if (typeof max === "number" && parsed > max) return max;
  return parsed;
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function normalizeWords(values) {
  const list = normalizeStringArray(values).map((word) => word.toLowerCase());
  return Array.from(new Set(list));
}

function resolveModerationConfig(configDoc) {
  const raw = configDoc?.moderation ?? {};
  const automod = raw.automod ?? {};
  const antiFlood = automod.antiFlood ?? {};
  const antiSpam = automod.antiSpam ?? {};
  const antiLink = automod.antiLink ?? {};
  const wordFilter = automod.wordFilter ?? {};
  const raidDetection = automod.raidDetection ?? {};

  return {
    logChannelId: raw.logChannelId ?? null,
    automod: {
      enabled: Boolean(automod.enabled),
      antiFlood: {
        enabled: Boolean(antiFlood.enabled),
        maxMessages: clampNumber(
          antiFlood.maxMessages,
          DEFAULT_CONFIG.automod.antiFlood.maxMessages,
          2,
          25
        ),
        intervalSeconds: clampNumber(
          antiFlood.intervalSeconds,
          DEFAULT_CONFIG.automod.antiFlood.intervalSeconds,
          2,
          60
        ),
        timeoutMinutes: clampNumber(
          antiFlood.timeoutMinutes,
          DEFAULT_CONFIG.automod.antiFlood.timeoutMinutes,
          0,
          10080
        ),
        deleteMessages:
          antiFlood.deleteMessages ?? DEFAULT_CONFIG.automod.antiFlood.deleteMessages
      },
      antiSpam: {
        enabled: Boolean(antiSpam.enabled),
        maxDuplicates: clampNumber(
          antiSpam.maxDuplicates,
          DEFAULT_CONFIG.automod.antiSpam.maxDuplicates,
          2,
          15
        ),
        intervalSeconds: clampNumber(
          antiSpam.intervalSeconds,
          DEFAULT_CONFIG.automod.antiSpam.intervalSeconds,
          3,
          60
        ),
        timeoutMinutes: clampNumber(
          antiSpam.timeoutMinutes,
          DEFAULT_CONFIG.automod.antiSpam.timeoutMinutes,
          0,
          10080
        ),
        deleteMessages:
          antiSpam.deleteMessages ?? DEFAULT_CONFIG.automod.antiSpam.deleteMessages
      },
      antiLink: {
        enabled: Boolean(antiLink.enabled),
        allowedRoleIds: normalizeStringArray(antiLink.allowedRoleIds),
        allowedChannelIds: normalizeStringArray(antiLink.allowedChannelIds),
        timeoutMinutes: clampNumber(
          antiLink.timeoutMinutes,
          DEFAULT_CONFIG.automod.antiLink.timeoutMinutes,
          0,
          10080
        ),
        deleteMessages:
          antiLink.deleteMessages ?? DEFAULT_CONFIG.automod.antiLink.deleteMessages
      },
      wordFilter: {
        enabled: Boolean(wordFilter.enabled),
        words: normalizeWords(wordFilter.words),
        timeoutMinutes: clampNumber(
          wordFilter.timeoutMinutes,
          DEFAULT_CONFIG.automod.wordFilter.timeoutMinutes,
          0,
          10080
        ),
        deleteMessages:
          wordFilter.deleteMessages ?? DEFAULT_CONFIG.automod.wordFilter.deleteMessages
      },
      raidDetection: {
        enabled: Boolean(raidDetection.enabled),
        maxJoins: clampNumber(
          raidDetection.maxJoins,
          DEFAULT_CONFIG.automod.raidDetection.maxJoins,
          2,
          50
        ),
        intervalSeconds: clampNumber(
          raidDetection.intervalSeconds,
          DEFAULT_CONFIG.automod.raidDetection.intervalSeconds,
          3,
          120
        )
      }
    }
  };
}

export async function getModerationConfig(guildId) {
  const cached = configCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let resolved = DEFAULT_CONFIG;
  try {
    const configDoc = await GuildConfig.findOne({ guildId });
    resolved = resolveModerationConfig(configDoc);
  } catch (error) {
    console.warn("Falha ao carregar config de moderacao:", error);
  }
  configCache.set(guildId, {
    value: resolved,
    expiresAt: Date.now() + CONFIG_TTL_MS
  });
  return resolved;
}

function truncate(value, limit = 512) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

async function sendModerationLog(guild, config, embed) {
  if (!config?.logChannelId) return;
  const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel || !channel.isTextBased?.()) return;
  try {
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.warn("Falha ao enviar log de moderacao:", error);
  }
}

export async function recordInfraction({
  guildId,
  userId,
  moderatorId,
  type,
  reason,
  durationMs
}) {
  return Infraction.create({
    guildId,
    userId,
    moderatorId,
    type,
    reason,
    durationMs
  });
}

export async function logModerationAction({
  guild,
  config,
  title,
  description,
  color = 0xf2b356,
  fields = []
}) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setDescription(description || null)
    .addFields(fields)
    .setTimestamp();
  await sendModerationLog(guild, config, embed);
}

function isBypassMember(member) {
  if (!member) return false;
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    member.permissions.has(PermissionFlagsBits.ModerateMembers)
  );
}

function messageHasLink(content) {
  if (!content) return false;
  const linkPattern =
    /(https?:\/\/|www\.)\S+/i;
  const invitePattern =
    /(discord\.gg\/|discord\.com\/invite\/)/i;
  return linkPattern.test(content) || invitePattern.test(content);
}

function recordMessage(userKey, content, windowMs) {
  const now = Date.now();
  const bucket = messageBuckets.get(userKey) ?? [];
  bucket.push({ timestamp: now, content });
  const cutoff = now - windowMs;
  while (bucket.length && bucket[0].timestamp < cutoff) {
    bucket.shift();
  }
  messageBuckets.set(userKey, bucket);
  return bucket;
}

async function applyAutomodAction({
  message,
  member,
  config,
  reason,
  title,
  timeoutMinutes,
  deleteMessages
}) {
  const guild = message.guild;
  const user = message.author;
  const timeoutMs =
    timeoutMinutes && timeoutMinutes > 0
      ? Math.round(timeoutMinutes * 60 * 1000)
      : 0;
  const actions = [];

  if (deleteMessages && message.deletable) {
    try {
      await message.delete();
      actions.push("mensagem removida");
    } catch (error) {
      console.warn("Falha ao deletar mensagem:", error);
    }
  }

  let timeoutApplied = false;
  if (timeoutMs > 0 && member?.moderatable) {
    try {
      await member.timeout(timeoutMs, reason);
      actions.push(`timeout ${timeoutMinutes}m`);
      timeoutApplied = true;
    } catch (error) {
      console.warn("Falha ao aplicar timeout:", error);
    }
  }

  try {
    await recordInfraction({
      guildId: guild.id,
      userId: user.id,
      moderatorId: message.client.user.id,
      type: "automod",
      reason,
      durationMs: timeoutApplied ? timeoutMs : undefined
    });
  } catch (error) {
    console.warn("Falha ao registrar infracao automod:", error);
  }

  const fields = [
    { name: "Usuario", value: `<@${user.id}> (${user.id})`, inline: false },
    { name: "Canal", value: `<#${message.channelId}>`, inline: true },
    {
      name: "Acao",
      value: actions.length ? actions.join(" | ") : "nenhuma",
      inline: true
    }
  ];

  if (message.content) {
    fields.push({
      name: "Conteudo",
      value: truncate(message.content, 900),
      inline: false
    });
  }

  await logModerationAction({
    guild,
    config,
    title,
    description: reason,
    fields,
    color: 0xff7b7b
  });
}

export async function handleAutomodMessage(message) {
  if (!message.guild || message.author?.bot) return;
  if (!message.member) return;

  const config = await getModerationConfig(message.guild.id);
  const automod = config.automod;
  if (!automod.enabled) return;

  if (isBypassMember(message.member)) return;

  const content = String(message.content ?? "");

  if (automod.antiLink.enabled && content) {
    const allowChannel = automod.antiLink.allowedChannelIds.includes(
      message.channelId
    );
    const allowRole = message.member.roles.cache.some((role) =>
      automod.antiLink.allowedRoleIds.includes(role.id)
    );
    if (!allowChannel && !allowRole && messageHasLink(content)) {
      await applyAutomodAction({
        message,
        member: message.member,
        config,
        reason: "Link nao permitido.",
        title: "AutoMod: Anti-link",
        timeoutMinutes: automod.antiLink.timeoutMinutes,
        deleteMessages: automod.antiLink.deleteMessages
      });
      return;
    }
  }

  if (automod.wordFilter.enabled && automod.wordFilter.words.length && content) {
    const lower = content.toLowerCase();
    const matched = automod.wordFilter.words.find((word) => lower.includes(word));
    if (matched) {
      await applyAutomodAction({
        message,
        member: message.member,
        config,
        reason: `Palavra bloqueada: ${matched}`,
        title: "AutoMod: Filtro de palavras",
        timeoutMinutes: automod.wordFilter.timeoutMinutes,
        deleteMessages: automod.wordFilter.deleteMessages
      });
      return;
    }
  }

  const floodEnabled = automod.antiFlood.enabled;
  const spamEnabled = automod.antiSpam.enabled;

  if (!floodEnabled && !spamEnabled) return;

  const maxWindowMs = Math.max(
    floodEnabled ? automod.antiFlood.intervalSeconds * 1000 : 0,
    spamEnabled ? automod.antiSpam.intervalSeconds * 1000 : 0
  );

  if (!maxWindowMs) return;

  const userKey = `${message.guild.id}:${message.author.id}`;
  const bucket = recordMessage(userKey, content.trim().toLowerCase(), maxWindowMs);
  const now = Date.now();

  if (floodEnabled) {
    const floodWindow = automod.antiFlood.intervalSeconds * 1000;
    const floodCount = bucket.filter((item) => now - item.timestamp <= floodWindow)
      .length;

    if (floodCount >= automod.antiFlood.maxMessages) {
      await applyAutomodAction({
        message,
        member: message.member,
        config,
        reason: `Flood detectado (${floodCount}/${automod.antiFlood.maxMessages}).`,
        title: "AutoMod: Anti-flood",
        timeoutMinutes: automod.antiFlood.timeoutMinutes,
        deleteMessages: automod.antiFlood.deleteMessages
      });
      return;
    }
  }

  if (spamEnabled && content.trim().length > 2) {
    const spamWindow = automod.antiSpam.intervalSeconds * 1000;
    const duplicates = bucket.filter(
      (item) =>
        item.content === content.trim().toLowerCase() &&
        now - item.timestamp <= spamWindow
    ).length;

    if (duplicates >= automod.antiSpam.maxDuplicates) {
      await applyAutomodAction({
        message,
        member: message.member,
        config,
        reason: `Spam detectado (mensagem repetida ${duplicates}x).`,
        title: "AutoMod: Anti-spam",
        timeoutMinutes: automod.antiSpam.timeoutMinutes,
        deleteMessages: automod.antiSpam.deleteMessages
      });
    }
  }
}

export async function handleModerationMemberJoin(member) {
  const config = await getModerationConfig(member.guild.id);
  const raid = config.automod.raidDetection;
  if (!raid.enabled) return;

  const now = Date.now();
  const windowMs = raid.intervalSeconds * 1000;
  const bucket = joinBuckets.get(member.guild.id) ?? [];
  bucket.push(now);
  const cutoff = now - windowMs;
  while (bucket.length && bucket[0] < cutoff) {
    bucket.shift();
  }
  joinBuckets.set(member.guild.id, bucket);

  if (bucket.length < raid.maxJoins) return;

  const lastAlert = raidAlertAt.get(member.guild.id) ?? 0;
  if (now - lastAlert < windowMs) return;
  raidAlertAt.set(member.guild.id, now);

  await logModerationAction({
    guild: member.guild,
    config,
    title: "AutoMod: Possivel raid",
    description: `Entradas recentes detectadas (${bucket.length} membros em ${raid.intervalSeconds}s).`,
    fields: [
      { name: "Servidor", value: member.guild.name, inline: true },
      { name: "Janela", value: `${raid.intervalSeconds}s`, inline: true }
    ],
    color: 0xf2b356
  });
}
