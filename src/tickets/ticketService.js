import crypto from "node:crypto";
import MarkdownIt from "markdown-it";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import Ticket from "../models/Ticket.js";
import TicketTranscript from "../models/TicketTranscript.js";
import { config } from "../config.js";
import {
  getGuildConfigLean,
  getOrCreateGuildConfigDoc
} from "../services/guildConfigService.js";

const DEFAULT_CATEGORY = {
  label: "Geral",
  description: "Suporte geral"
};

const MAX_TRANSCRIPT_MESSAGES = 300;
const MAX_TICKET_QUESTIONS = 5;
const pendingTicketForms = new Map();
const openingTicketLocks = new Map();

const ticketTouchAt = global._mbTicketTouchAt ?? new Map();
global._mbTicketTouchAt = ticketTouchAt;

const transcriptMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false
});

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed)) return fallback;
  if (typeof min === "number" && parsed < min) return min;
  if (typeof max === "number" && parsed > max) return max;
  return parsed;
}

function normalizeLabel(value) {
  return value?.trim().toLowerCase();
}

function slugifyLabel(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function buildCategoryName(label) {
  const slug = slugifyLabel(label);
  const base = slug ? `tickets-${slug}` : "tickets";
  return base.slice(0, 90).replace(/-+$/g, "");
}

function toPlainConfig(configDoc) {
  if (!configDoc?.tickets) {
    return null;
  }
  return typeof configDoc.tickets.toObject === "function"
    ? configDoc.tickets.toObject()
    : { ...configDoc.tickets };
}

export function resolveTicketConfig(configDoc) {
  const raw = toPlainConfig(configDoc) ?? {};
  const categories = raw.categories?.length ? raw.categories : [DEFAULT_CATEGORY];

  const autoCloseRaw = raw.autoClose ?? {};
  const autoCloseEnabled = Boolean(autoCloseRaw.enabled);
  const autoCloseAfterMinutes = clampInt(autoCloseRaw.afterMinutes, 0, 0, 60 * 24 * 30);
  let reminderMinutes = clampInt(autoCloseRaw.reminderMinutes, 0, 0, 60 * 24 * 30);
  if (!autoCloseEnabled || autoCloseAfterMinutes <= 0) {
    reminderMinutes = 0;
  } else if (reminderMinutes >= autoCloseAfterMinutes) {
    reminderMinutes = 0;
  }

  return {
    type: raw.type ?? "thread",
    openChannelId: raw.openChannelId ?? null,
    categoryChannelId: raw.categoryChannelId ?? null,
    formResponseTemplate: raw.formResponseTemplate ?? "",
    autoClose: {
      enabled: autoCloseEnabled && autoCloseAfterMinutes > 0,
      afterMinutes: autoCloseEnabled ? autoCloseAfterMinutes : 0,
      reminderMinutes
    },
    categories,
    staffRoleIds: raw.staffRoleIds ?? []
  };
}

export async function getOrCreateGuildConfig(guildId) {
  return getOrCreateGuildConfigDoc(guildId);
}

export async function getTicketConfigForGuild(guildId) {
  const configDoc = await getGuildConfigLean(guildId).catch(() => null);
  return resolveTicketConfig(configDoc);
}

export function buildCategorySelect(userId, categories) {
  const suffix = userId ? userId : "public";
  const options = categories.slice(0, 25).map((category) => ({
    label: category.label,
    description: category.description?.slice(0, 100) ?? undefined,
    value: category.label
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`ticket_category:${suffix}`)
    .setPlaceholder("Escolha a categoria")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return [new ActionRowBuilder().addComponents(select)];
}

export function buildTicketControls() {
  const claim = new ButtonBuilder()
    .setCustomId("ticket_claim")
    .setLabel("Assumir")
    .setStyle(ButtonStyle.Primary);

  const transfer = new ButtonBuilder()
    .setCustomId("ticket_transfer")
    .setLabel("Transferir")
    .setStyle(ButtonStyle.Secondary);

  const close = new ButtonBuilder()
    .setCustomId("ticket_close")
    .setLabel("Fechar")
    .setStyle(ButtonStyle.Danger);

  return [new ActionRowBuilder().addComponents(claim, transfer, close)];
}

export function isStaff(member, ticketConfig) {
  if (!member) return false;

  if (ticketConfig.staffRoleIds?.length) {
    return member.roles.cache.some((role) =>
      ticketConfig.staffRoleIds.includes(role.id)
    );
  }

  return (
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels)
  );
}

function canCreateThread(channel) {
  return (
    channel &&
    "threads" in channel &&
    (channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement)
  );
}

async function tryPinMessage(message) {
  if (!message || typeof message.pin !== "function") return;
  try {
    if (message.pinned) return;
    await message.pin();
  } catch (error) {
    // falta permissão ou canal/thread não permite pin; não bloqueia o fluxo do ticket
    console.warn("Falha ao fixar mensagem do ticket:", error);
  }
}

function buildTicketIntro({ ownerId, categoryLabel, staffRoleIds }) {
  const staffLine = staffRoleIds?.length
    ? `Equipe: ${staffRoleIds.map((id) => `<@&${id}>`).join(" ")}`
    : "Equipe: nao configurada";

  return [
    `Ticket aberto por <@${ownerId}>`,
    `Categoria: ${categoryLabel}`,
    staffLine
  ].join("\n");
}

function buildTicketIntroEmbed({ ownerId, categoryLabel, staffRoleIds }) {
  const staffLine = staffRoleIds?.length
    ? staffRoleIds.map((id) => `<@&${id}>`).join(" ")
    : "Nao configurada";

  return {
    title: "Ticket aberto",
    color: 0x2fffe0,
    fields: [
      { name: "Usuario", value: `<@${ownerId}>`, inline: true },
      { name: "Categoria", value: categoryLabel || "Nao definida", inline: true },
      { name: "Equipe", value: staffLine, inline: false }
    ]
  };
}
function findCategoryConfig(categories, categoryLabel) {
  const target = normalizeLabel(categoryLabel);
  return categories.find(
    (category) => normalizeLabel(category.label) === target
  );
}

function applyTemplateVariables(template, { interaction, categoryLabel }) {
  if (!template) return "";
  const guildName = interaction.guild?.name ?? "";
  const user = interaction.user;
  return String(template)
    .replaceAll("{user}", `<@${user.id}>`)
    .replaceAll("{username}", user.username ?? "")
    .replaceAll("{userTag}", user.tag ?? "")
    .replaceAll("{category}", categoryLabel ?? "")
    .replaceAll("{server}", guildName)
    .trim();
}

function categoryKeyOf(label) {
  return slugifyLabel(label) || normalizeLabel(label);
}

function buildTicketModal(categoryLabel, questions) {
  const modal = new ModalBuilder()
    .setCustomId("ticket_form")
    .setTitle(`Ticket: ${String(categoryLabel).slice(0, 40)}`);

  const rows = questions.slice(0, MAX_TICKET_QUESTIONS).map((question, index) => {
    const input = new TextInputBuilder()
      .setCustomId(`q${index}`)
      .setLabel(String(question).slice(0, 45))
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
    return new ActionRowBuilder().addComponents(input);
  });

  modal.addComponents(rows);
  return modal;
}

function collectFormAnswers(questions, interaction) {
  return questions.slice(0, MAX_TICKET_QUESTIONS).map((question, index) => ({
    question,
    answer: interaction.fields.getTextInputValue(`q${index}`) ?? ""
  }));
}

function buildFormAnswersEmbed(answers, interaction, ticketConfig, categoryLabel) {

  const user = interaction.user;

  const embed = new EmbedBuilder()
    .setTitle(`Formulário • ${String(categoryLabel ?? "Ticket").slice(0, 64)}`)
    .setDescription(`Enviado por <@${user.id}>`)
    .setColor(0x2fffe0);

  for (const { question, answer } of answers ?? []) {
    const q = String(question ?? "").trim().slice(0, 256) || "Pergunta";
    const a = String(answer ?? "").trim() || "_sem resposta_";
    const value = a.length > 900 ? a.slice(0, 900) + "…" : a;
    embed.addFields({ name: `**${q}**`, value: "```" + value + "```", inline: false });
  }

  const template = String(ticketConfig.formResponseTemplate ?? "").trim();
  if (template) {
    const extra = applyTemplateVariables(template, { interaction, categoryLabel }).slice(0, 1000);
    if (extra) embed.addFields({ name: "Mensagem", value: extra, inline: false });
  }

  return embed;
}

async function resolveActiveTicket({ client, guildId, ownerId, member, categoryLabel }) {
  const categoryKey = categoryLabel ? categoryKeyOf(categoryLabel) : null;

  const candidates = await Ticket.find({
    guildId,
    ownerId,
    status: "open"
  }).sort({ createdAt: -1 });

  const existing = categoryKey
    ? candidates.find((t) => (t.categoryKey ? t.categoryKey === categoryKey : categoryKeyOf(t.categoryLabel) === categoryKey))
    : candidates[0] ?? null;

  if (!existing) return null;

  try {
    const channel = await client.channels.fetch(existing.channelId);
    if (!channel) throw new Error("channel_not_found");

    if (channel.isThread && (channel.archived || channel.locked)) {
      existing.status = "closed";
      existing.closedAt = new Date();
      await existing.save();
      return null;
    }

    if (member) {
      const canView = channel.permissionsFor(member)?.has(
        PermissionFlagsBits.ViewChannel
      );
      if (!canView) {
        existing.status = "closed";
        existing.closedAt = new Date();
        await existing.save();
        return null;
      }
    }

    if (channel.isThread && channel.members) {
      try {
        await channel.members.fetch(ownerId);
      } catch {
        existing.status = "closed";
        existing.closedAt = new Date();
        await existing.save();
        return null;
      }
    }

    return existing;
  } catch {
    existing.status = "closed";
    existing.closedAt = new Date();
    await existing.save();
    return null;
  }
}

function buildCloseTagOptions(ticketConfig) {
  const categories = ticketConfig.categories ?? [];
  const options = categories
    .filter((category) => category?.label)
    .slice(0, 24)
    .map((category) => ({
      label: category.label.slice(0, 100),
      value: category.label.slice(0, 100)
    }));

  if (!options.length) {
    options.push(
      { label: "Bug", value: "bug" },
      { label: "Denuncia", value: "denuncia" },
      { label: "Parceria", value: "parceria" },
      { label: "Outro", value: "outro" }
    );
  }

  options.push({ label: "Outra (digitar)", value: "custom" });
  options.push({ label: "Sem tag", value: "sem_tag" });
  return options;
}

function normalizeTagValue(value) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned || cleaned === "sem_tag") return null;
  return cleaned.slice(0, 64);
}

async function finalizeTicketClose(interaction, channelId, tagValue) {
  const ticket = await Ticket.findOne({ channelId });

  if (!ticket) {
    await interaction.reply({
      content: "Ticket nao encontrado.",
      ephemeral: true
    });
    return;
  }

  const ticketConfig = await getTicketConfigForGuild(interaction.guildId);

  const isOwner = interaction.user.id === ticket.ownerId;
  if (!isOwner && !isStaff(interaction.member, ticketConfig)) {
    await interaction.reply({
      content: "Voce nao pode fechar este ticket.",
      ephemeral: true
    });
    return;
  }

  if (ticket.status === "closed") {
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.channel;
    if (channel?.isThread?.()) {
      try {
        await channel.setLocked(true);
        await channel.setArchived(true);
      } catch {}
    } else {
      setTimeout(async () => {
        try {
          await channel.delete("Ticket ja estava marcado como fechado");
        } catch {}
      }, 1500);
    }

    await interaction.editReply({
      content: "Este ticket ja estava marcado como fechado. Finalizando o canal agora."
    });
    return;
  }

  const tag = normalizeTagValue(tagValue);
  ticket.status = "closed";
  ticket.closedAt = new Date();
  ticket.tag = tag;
  await ticket.save();

  await interaction.deferReply({ ephemeral: true });

  const channel = interaction.channel;
  let transcriptContent = "Sem mensagens.";
  let transcriptHtml = "";
  let transcriptLink = "";

  try {
    const messages = await fetchTranscriptMessages(channel);
    transcriptContent = await buildTranscriptMarkdownFromMessages(messages);
    transcriptHtml = await buildTranscriptHtml(channel, messages);

    const transcriptId = crypto.randomBytes(16).toString("hex");
    await TicketTranscript.create({
      transcriptId,
      guildId: interaction.guildId,
      channelId: channel.id,
      ownerId: ticket.ownerId,
      messageCount: messages.length,
      markdown: transcriptContent,
      html: transcriptHtml
    });

    if (config.panelBaseUrl) {
      transcriptLink = `${config.panelBaseUrl}/transcript/${transcriptId}`;
    }
  } catch (error) {
    console.error("Falha ao gerar transcript:", error);
  }

  const attachment = new AttachmentBuilder(
    Buffer.from(transcriptContent, "utf8"),
    { name: `transcript-${channel.id}.md` }
  );

  try {
    await channel.send({
      content: transcriptLink
        ? `Transcript do ticket: ${transcriptLink}`
        : "Transcript do ticket:",
      files: [attachment]
    });
  } catch (error) {
    console.error("Falha ao enviar transcript no canal:", error);
  }

  let owner = null;
  try {
    owner = await interaction.client.users.fetch(ticket.ownerId);
    await owner.send({
      content: transcriptLink
        ? `Seu ticket foi fechado. Transcript: ${transcriptLink}`
        : "Seu ticket foi fechado. Transcript em anexo:",
      files: [attachment]
    });
  } catch (error) {
    console.warn("Nao foi possivel enviar transcript ao usuario:", error);
  }

  try {
    const guild = interaction.guild;
    if (guild) {
      const logChannel = await getOrCreateTranscriptLogChannel(
        guild,
        ticketConfig
      );
      if (logChannel) {
        const resolvedOwner =
          owner ?? (await interaction.client.users.fetch(ticket.ownerId).catch(() => null));
        const ownerName = resolvedOwner?.tag ?? `Usuario ${ticket.ownerId}`;
        const categoryLabel = ticket.categoryLabel ?? "Sem categoria";
        const createdAt = ticket.createdAt ?? new Date();
        const createdAtLabel = createdAt.toLocaleString("pt-BR");
        const title = `${ownerName} • ${categoryLabel} • ${createdAtLabel}`.slice(
          0,
          256
        );
        const embed = {
          title,
          description: transcriptLink
            ? `Transcript: ${transcriptLink}`
            : "Transcript em anexo.",
          color: 0x2fffe0,
          fields: [
            { name: "Tag", value: tag ?? "Sem tag", inline: true },
            { name: "Canal", value: `#${channel.name}`, inline: true }
          ]
        };

        const logAttachment = new AttachmentBuilder(
          Buffer.from(transcriptContent, "utf8"),
          { name: `transcript-${channel.id}.md` }
        );

        await logChannel.send({
          embeds: [embed],
          files: [logAttachment]
        });
      }
    }
  } catch (error) {
    console.warn("Falha ao enviar transcript para logs:", error);
  }

  if (channel.isThread()) {
    try {
      await channel.setLocked(true);
      await channel.setArchived(true);
    } catch (error) {
      console.error("Falha ao arquivar thread:", error);
    }
  } else {
    setTimeout(async () => {
      try {
        await channel.delete("Ticket fechado");
      } catch (error) {
        console.error("Falha ao deletar canal:", error);
      }
    }, 5000);
  }

  await interaction.editReply({ content: "Ticket fechado." });
}

function buildLogOverwrites(guild, ticketConfig) {
  if (!ticketConfig.staffRoleIds?.length) return null;
  const botId = guild.members.me?.id ?? guild.client.user.id;
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages
      ]
    }
  ];

  for (const roleId of ticketConfig.staffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    });
  }

  return overwrites;
}

async function getOrCreateTranscriptLogChannel(guild, ticketConfig) {
  const categoryName = "logs-bot";
  const channelName = "transcripts-logs";
  const lowerCategoryName = categoryName.toLowerCase();
  const lowerChannelName = channelName.toLowerCase();

  let category = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildCategory &&
      channel.name?.toLowerCase() === lowerCategoryName
  );

  if (!category) {
    const fetched = await guild.channels.fetch();
    category = fetched.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        channel.name?.toLowerCase() === lowerCategoryName
    );
  }

  let createdCategory = false;
  if (!category) {
    const overwrites = buildLogOverwrites(guild, ticketConfig);
    category = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwrites ?? undefined,
      reason: "Categoria de logs do Master Bot"
    });
    createdCategory = true;
  }

  let logChannel = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.parentId === category.id &&
      channel.name?.toLowerCase() === lowerChannelName
  );

  if (!logChannel) {
    const fetched = await guild.channels.fetch();
    logChannel = fetched.find(
      (channel) =>
        channel.type === ChannelType.GuildText &&
        channel.parentId === category.id &&
        channel.name?.toLowerCase() === lowerChannelName
    );
  }

  if (!logChannel) {
    logChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category.id,
      reason: "Canal de logs de transcripts do Master Bot"
    });
  }

  return logChannel;
}

async function sendCategoryTemplate(channel, { interaction, categoryLabel, category }) {
  if (!category?.template) return;
  const content = applyTemplateVariables(category.template, {
    interaction,
    categoryLabel
  });
  if (!content) return;
  try {
    await channel.send({ content: content.slice(0, 2000) });
  } catch (error) {
    console.warn("Falha ao enviar template da categoria:", error);
  }
}

async function createTicketThread({ interaction, ticketConfig, categoryLabel }) {
  const channel = interaction.channel;

  if (!canCreateThread(channel)) {
    throw new Error("Este canal nao suporta threads.");
  }

  const name = `ticket-${interaction.user.username}`.slice(0, 90);
  const thread = await channel.threads.create({
    name,
    autoArchiveDuration: 1440,
    reason: `Ticket aberto por ${interaction.user.tag}`
  });

  try {
    await thread.members.add(interaction.user.id);
  } catch (error) {
    console.warn("Falha ao adicionar usuario na thread:", error);
  }

  const introMessage = await thread.send({
    embeds: [
      buildTicketIntroEmbed({
        ownerId: interaction.user.id,
        categoryLabel,
        staffRoleIds: ticketConfig.staffRoleIds
      })
    ],
    components: buildTicketControls()
  });

  await tryPinMessage(introMessage);

  return thread;
}

async function createTicketChannel({ interaction, ticketConfig, categoryLabel }) {
  const guild = interaction.guild;

  if (!ticketConfig.staffRoleIds?.length) {
    throw new Error("Defina ao menos um cargo de staff para tickets.");
  }

  const categoryName = buildCategoryName(categoryLabel);
  let categoryChannel = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildCategory &&
      channel.name?.toLowerCase() === categoryName.toLowerCase()
  );

  if (!categoryChannel) {
    const fetched = await guild.channels.fetch();
    categoryChannel = fetched.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        channel.name?.toLowerCase() === categoryName.toLowerCase()
    );
  }

  if (!categoryChannel) {
    categoryChannel = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
      reason: `Categoria para tickets: ${categoryLabel}`
    });
  }

  const botId = guild.members.me?.id ?? interaction.client.user.id;
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages
      ]
    }
  ];

  for (const roleId of ticketConfig.staffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages
      ]
    });
  }

  const channel = await guild.channels.create({
    name: `ticket-${interaction.user.username}`.slice(0, 90),
    type: ChannelType.GuildText,
    parent: categoryChannel.id,
    reason: `Ticket aberto por ${interaction.user.tag}`,
    permissionOverwrites: overwrites
  });

  const introMessage = await channel.send({
    embeds: [
      buildTicketIntroEmbed({
        ownerId: interaction.user.id,
        categoryLabel,
        staffRoleIds: ticketConfig.staffRoleIds
      })
    ],
    components: buildTicketControls()
  });

  await tryPinMessage(introMessage);

  return channel;
}

async function fetchTranscriptMessages(channel) {
  let lastId = null;
  const messages = [];

  while (messages.length < MAX_TRANSCRIPT_MESSAGES) {
    const batch = await channel.messages.fetch({
      limit: 100,
      before: lastId ?? undefined
    });

    if (!batch.size) break;

    messages.push(...batch.values());
    lastId = batch.last().id;
  }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return messages;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getMentionName(message, userId) {
  const member =
    typeof message.mentions?.members?.get === "function"
      ? message.mentions.members.get(userId)
      : null;
  if (member?.displayName) return member.displayName;

  const user =
    typeof message.mentions?.users?.get === "function"
      ? message.mentions.users.get(userId)
      : null;
  if (user?.username) return user.username;

  return `user-${userId}`;
}

function getRoleName(message, roleId) {
  const role =
    typeof message.mentions?.roles?.get === "function"
      ? message.mentions.roles.get(roleId)
      : null;
  return role?.name ?? `cargo-${roleId}`;
}

function getChannelName(message, channelId) {
  const mentioned =
    typeof message.mentions?.channels?.get === "function"
      ? message.mentions.channels.get(channelId)
      : null;
  return mentioned?.name ?? `canal-${channelId}`;
}

function renderTranscriptContentHtml(message) {
  const raw = String(message.content ?? "").trim();
  if (!raw) return "";

  let html = transcriptMarkdown.render(raw);

  const protectedChunks = [];
  const protect = (regex) => {
    html = html.replace(regex, (match) => {
      const key = `@@MB_PROTECT_${protectedChunks.length}@@`;
      protectedChunks.push(match);
      return key;
    });
  };

  protect(/<pre><code[^>]*>[\s\S]*?<\/code><\/pre>/g);
  protect(/<code>[\s\S]*?<\/code>/g);

  html = html.replace(/&lt;@!?(\\d+)&gt;/g, (_, id) => {
    const name = escapeHtml(getMentionName(message, id));
    return `<span class="mention mention-user">@${name}</span>`;
  });

  html = html.replace(/&lt;@&(\\d+)&gt;/g, (_, id) => {
    const name = escapeHtml(getRoleName(message, id));
    return `<span class="mention mention-role">@${name}</span>`;
  });

  html = html.replace(/&lt;#(\\d+)&gt;/g, (_, id) => {
    const name = escapeHtml(getChannelName(message, id));
    return `<span class="mention mention-channel">#${name}</span>`;
  });

  html = html.replace(
    /&lt;(a?):([a-zA-Z0-9_]+):(\\d+)&gt;/g,
    (_, animated, name, id) => {
      const ext = animated ? "gif" : "png";
      const alt = escapeHtml(`:${name}:`);
      return `<img class="emoji" alt="${alt}" src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=32&quality=lossless" />`;
    }
  );

  html = html.replace(/(^|[\\s>])(@everyone|@here)(?=\\s|<|$)/g, (m, p1, p2) => {
    return `${p1}<span class="mention mention-special">${escapeHtml(p2)}</span>`;
  });

  for (let i = 0; i < protectedChunks.length; i++) {
    html = html.replaceAll(`@@MB_PROTECT_${i}@@`, protectedChunks[i]);
  }

  return html;
}

function formatEmbedsHtml(embeds = []) {
  if (!embeds.length) return "";

  const blocks = embeds.map((embed) => {
    const color =
      typeof embed.color === "number"
        ? `#${embed.color.toString(16).padStart(6, "0")}`
        : "#35e7ff";
    const author = embed.author?.name
      ? `<div class=\"embed-author\">${
          embed.author.iconURL || embed.author.icon_url
            ? `<img src=\"${embed.author.iconURL ?? embed.author.icon_url}\" alt=\"author\" />`
            : ""
        }<span>${escapeHtml(embed.author.name)}</span></div>`
      : "";
    const title = embed.title ? `<div class=\"embed-title\">${escapeHtml(embed.title)}</div>` : "";
    const description = embed.description
      ? `<div class=\"embed-desc\">${escapeHtml(embed.description)}</div>`
      : "";

    const fields = embed.fields?.length
      ? `<div class=\"embed-fields\">${embed.fields
          .map(
            (field) =>
              `<div class=\"embed-field\"><div class=\"embed-field-name\">${escapeHtml(
                field.name
              )}</div><div class=\"embed-field-value\">${escapeHtml(
                field.value
              )}</div></div>`
          )
          .join("")}</div>`
      : "";

    const footer = embed.footer?.text
      ? `<div class=\"embed-footer\">${escapeHtml(embed.footer.text)}</div>`
      : "";

    const image = embed.image?.url
      ? `<div class=\"embed-image\"><img src=\"${embed.image.url}\" alt=\"embed image\" /></div>`
      : "";

    return `<div class=\"embed\" style=\"border-left-color: ${color}\">${author}${title}${description}${fields}${image}${footer}</div>`;
  });

  return `<div class=\"embed-list\">${blocks.join("")}</div>`;
}

async function buildTranscriptMarkdownFromMessages(messages) {
  const lines = messages.map((message) => {
    const timestamp = new Date(message.createdTimestamp).toISOString();
    const author = message.author?.tag ?? "Unknown";
    const content = message.cleanContent || "";
    const attachments = message.attachments.size
      ? ` [Anexos: ${[...message.attachments.values()]
          .map((file) => file.url)
          .join(", ")}]`
      : "";

    return `[${timestamp}] ${author}: ${content}${attachments}`.trim();
  });

  return lines.length ? lines.join("\n") : "Sem mensagens.";
}

async function buildTranscriptHtml(channel, messages) {
  const rows = messages.map((message) => {
    const timestamp = new Date(message.createdTimestamp).toLocaleString("pt-BR");
    const author = message.author?.tag ?? "Unknown";
    const avatar = message.author?.displayAvatarURL?.({ size: 64 }) ?? "";
    const content = renderTranscriptContentHtml(message);
    const attachments = message.attachments.size
      ? `<div class=\"attachments\">${[...message.attachments.values()]
          .map(
            (file) =>
              `<a href=\"${file.url}\" target=\"_blank\" rel=\"noreferrer\">${escapeHtml(
                file.name
              )}</a>`
          )
          .join("")}</div>`
      : "";

    const embeds = formatEmbedsHtml(message.embeds ?? []);

    return `<div class=\"message\">
      <div class=\"avatar\">${avatar ? `<img src=\"${avatar}\" alt=\"${escapeHtml(author)}\" />` : ""}</div>
      <div class=\"content\">
        <div class=\"meta\"><span class=\"author\">${escapeHtml(author)}</span><span class=\"time\">${escapeHtml(
          timestamp
        )}</span></div>
        ${content ? `<div class=\"text markdown\">${content}</div>` : ""}
        ${attachments}
        ${embeds}
      </div>
    </div>`;
  });

  const header = `<div class=\"transcript-header\">
    <h1>Transcript do ticket</h1>
    <div class=\"meta\">Canal: #${escapeHtml(channel.name ?? "ticket")}</div>
    <div class=\"meta\">Mensagens: ${messages.length}</div>
  </div>`;

  return `<!doctype html>
<html lang=\"pt-BR\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>Transcript - Master Bot</title>
    <style>
      body { font-family: Arial, sans-serif; background: #0a0f1a; color: #f5f6f7; margin: 0; padding: 24px; }
      .transcript-header { margin-bottom: 24px; }
      .transcript-header h1 { margin: 0 0 8px; font-size: 22px; }
      .meta { color: #9aa6b6; font-size: 12px; }
      .message { display: grid; grid-template-columns: 48px 1fr; gap: 12px; padding: 12px 0; border-bottom: 1px solid rgba(150,160,178,0.15); }
      .avatar img { width: 44px; height: 44px; border-radius: 50%; }
      .author { font-weight: 700; }
      .time { margin-left: 8px; color: #9aa6b6; font-size: 12px; }
      .text { margin-top: 6px; }
      .markdown { line-height: 1.35; }
      .markdown p { margin: 0 0 8px; }
      .markdown p:last-child { margin-bottom: 0; }
      .markdown a { color: #35e7ff; text-decoration: none; }
      .markdown a:hover { text-decoration: underline; }
      .markdown strong { font-weight: 800; }
      .markdown em { font-style: italic; }
      .markdown code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace; font-size: 12px; background: rgba(255,255,255,0.06); padding: 2px 4px; border-radius: 6px; }
      .markdown pre { background: rgba(255,255,255,0.06); padding: 12px; border-radius: 10px; overflow: auto; margin: 8px 0; }
      .markdown pre code { background: transparent; padding: 0; }
      .markdown blockquote { border-left: 3px solid rgba(53,231,255,0.6); padding-left: 10px; margin: 8px 0; color: #d7dced; }
      .markdown ul, .markdown ol { margin: 6px 0 6px 20px; padding: 0; }
      .mention { display: inline-block; padding: 1px 6px; border-radius: 999px; font-weight: 700; }
      .mention-user { background: rgba(88,101,242,0.22); color: #c9d0ff; }
      .mention-role { background: rgba(235,69,158,0.18); color: #ffd1eb; }
      .mention-channel { background: rgba(53,231,255,0.12); color: #bff6ff; }
      .mention-special { background: rgba(255,209,102,0.18); color: #ffe4b0; }
      .emoji { width: 20px; height: 20px; vertical-align: -4px; }
      .attachments a { display: inline-block; margin-right: 8px; color: #35e7ff; font-size: 12px; }
      .embed { border-left: 3px solid #35e7ff; background: rgba(20,30,44,0.7); padding: 10px; margin-top: 8px; border-radius: 8px; }
      .embed-author { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #d7dced; }
      .embed-author img { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; }
      .embed-title { font-weight: 700; margin-bottom: 4px; }
      .embed-desc { color: #d7dced; font-size: 13px; }
      .embed-fields { display: grid; gap: 8px; margin-top: 8px; }
      .embed-field-name { font-weight: 600; font-size: 12px; }
      .embed-field-value { font-size: 12px; color: #c4cada; }
      .embed-image img { max-width: 100%; border-radius: 6px; margin-top: 8px; }
      .embed-footer { margin-top: 6px; font-size: 11px; color: #9aa6b6; }
    </style>
  </head>
  <body>
    ${header}
    ${rows.join("\n")}
  </body>
</html>`;
}

export async function handleTicketOpen(interaction) {
  const ticketConfig = await getTicketConfigForGuild(interaction.guildId);

  if (
    ticketConfig.openChannelId &&
    interaction.channelId !== ticketConfig.openChannelId
  ) {
    await interaction.reply({
      content: "Use o canal configurado para abrir tickets.",
      ephemeral: true
    });
    return;
  }

  const categories = ticketConfig.categories;

  if (!categories.length) {
    await interaction.reply({
      content: "Nenhuma categoria configurada.",
      ephemeral: true
    });
    return;
  }

  if (categories.length === 1) {
    const categoryLabel = categories[0].label;
    const category = findCategoryConfig(categories, categoryLabel);
    const questions = category?.questions ?? [];

    const existing = await resolveActiveTicket({
      client: interaction.client,
      guildId: interaction.guildId,
      ownerId: interaction.user.id,
      member: interaction.member,
      categoryLabel
    });

    if (existing) {
      await interaction.reply({
        content: `Voce ja tem um ticket aberto nesta categoria: <#${existing.channelId}>`,
        ephemeral: true
      });
      return;
    }

    if (questions.length) {
      pendingTicketForms.set(`${interaction.guildId}:${interaction.user.id}`, {
        categoryLabel,
        questions: questions.slice(0, MAX_TICKET_QUESTIONS),
        createdAt: Date.now()
      });
      await interaction.showModal(buildTicketModal(categoryLabel, questions));
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    await openTicketWithCategory(interaction, categoryLabel, ticketConfig);
    return;
  }

  await interaction.reply({
    content: "Selecione uma categoria:",
    components: buildCategorySelect(interaction.user.id, categories),
    ephemeral: true
  });
}

async function openTicketWithCategory(interaction, categoryLabel, ticketConfig) {
  try {
    const lockKey = `${interaction.guildId}:${interaction.user.id}:${categoryKeyOf(categoryLabel)}`;
    if (openingTicketLocks.has(lockKey)) {
      const response = "Seu ticket desta categoria ja esta sendo criado. Aguarde alguns segundos.";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: response });
      } else {
        await interaction.reply({ content: response, ephemeral: true });
      }
      return null;
    }

    openingTicketLocks.set(lockKey, Date.now());
    try {
    const existing = await resolveActiveTicket({
      client: interaction.client,
      guildId: interaction.guildId,
      ownerId: interaction.user.id,
      member: interaction.member,
      categoryLabel
    });

    if (existing) {
      const response = `Voce ja tem um ticket aberto nesta categoria: <#${existing.channelId}>`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: response });
      } else {
        await interaction.reply({ content: response, ephemeral: true });
      }
      return null;
    }

    let channel;

    if (ticketConfig.type === "channel") {
      channel = await createTicketChannel({
        interaction,
        ticketConfig,
        categoryLabel
      });
    } else {
      channel = await createTicketThread({
        interaction,
        ticketConfig,
        categoryLabel
      });
    }

    const category = findCategoryConfig(ticketConfig.categories ?? [], categoryLabel);
    await sendCategoryTemplate(channel, { interaction, categoryLabel, category });

    try {
      await Ticket.create({
        guildId: interaction.guildId,
        channelId: channel.id,
        ownerId: interaction.user.id,
        categoryLabel,
        categoryKey: categoryKeyOf(categoryLabel),
        lastActivityAt: new Date()
      });
    } catch (error) {
      // Se houver corrida (2 aberturas ao mesmo tempo), apaga o canal criado e devolve o ticket existente.
      if (error?.code === 11000) {
        try {
          await channel.delete?.("Ticket duplicado por categoria (corrida).");
        } catch {}

        const existingAfter = await resolveActiveTicket({
          client: interaction.client,
          guildId: interaction.guildId,
          ownerId: interaction.user.id,
          member: interaction.member,
          categoryLabel
        });

        const response = existingAfter?.channelId
          ? `Voce ja tem um ticket aberto nesta categoria: <#${existingAfter.channelId}>`
          : "Voce ja tem um ticket aberto nesta categoria.";

        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: response });
        } else {
          await interaction.reply({ content: response, ephemeral: true });
        }
        return null;
      }
      throw error;
    }

    const response = `Ticket criado: ${channel.toString()}`;

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: response });
    } else {
      await interaction.reply({ content: response, ephemeral: true });
    }
    return channel;
    } finally {
      openingTicketLocks.delete(lockKey);
    }
  } catch (error) {
    const message = error?.message ?? "Falha ao criar ticket.";

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
  return null;
}

export async function handleTicketCategorySelect(interaction) {
  const [, userId] = interaction.customId.split(":");

  if (userId && userId !== "public" && userId !== interaction.user.id) {
    await interaction.reply({
      content: "Este menu nao e para voce.",
      ephemeral: true
    });
    return;
  }

  const categoryLabel = interaction.values?.[0];
  if (!categoryLabel) return;

  const ticketConfig = await getTicketConfigForGuild(interaction.guildId);
  try {
    // Limpa a seleção do menu (volta pro placeholder) para permitir novas escolhas sem ficar "marcado".
    if (interaction.message?.editable) {
      await interaction.message.edit({
        content: "Selecione uma categoria:",
        components: buildCategorySelect(
          userId && userId !== "public" ? userId : "public",
          ticketConfig.categories ?? []
        )
      });
    }
  } catch {}
  const category = findCategoryConfig(ticketConfig.categories ?? [], categoryLabel);
  const questions = category?.questions ?? [];

  const existing = await resolveActiveTicket({
    client: interaction.client,
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    member: interaction.member,
    categoryLabel
  });

  if (existing) {
    await interaction.reply({
      content: `Voce ja tem um ticket aberto nesta categoria: <#${existing.channelId}>`,
      ephemeral: true
    });
    return;
  }

  if (questions.length) {
    pendingTicketForms.set(`${interaction.guildId}:${interaction.user.id}`, {
      categoryLabel,
      questions: questions.slice(0, MAX_TICKET_QUESTIONS),
      createdAt: Date.now()
    });
    await interaction.showModal(buildTicketModal(categoryLabel, questions));
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await openTicketWithCategory(interaction, categoryLabel, ticketConfig);
}

export async function handleTicketFormSubmit(interaction) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const pending = pendingTicketForms.get(key);
  if (!pending) {
    await interaction.reply({
      content: "Formulario expirado. Tente abrir o ticket novamente.",
      ephemeral: true
    });
    return;
  }

  if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
    pendingTicketForms.delete(key);
    await interaction.reply({
      content: "Formulario expirado. Tente abrir o ticket novamente.",
      ephemeral: true
    });
    return;
  }

  pendingTicketForms.delete(key);
  const answers = collectFormAnswers(pending.questions, interaction);

  const ticketConfig = await getTicketConfigForGuild(interaction.guildId);

  if (
    ticketConfig.openChannelId &&
    interaction.channelId !== ticketConfig.openChannelId
  ) {
    await interaction.reply({
      content: "Use o canal configurado para abrir tickets.",
      ephemeral: true
    });
    return;
  }

  const existing = await resolveActiveTicket({
    client: interaction.client,
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    member: interaction.member,
    categoryLabel: pending.categoryLabel
  });

  if (existing) {
    await interaction.reply({
      content: `Voce ja tem um ticket aberto nesta categoria: <#${existing.channelId}>`,
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const channel = await openTicketWithCategory(
    interaction,
    pending.categoryLabel,
    ticketConfig
  );

  if (channel) {
    try {
      const answersEmbed = buildFormAnswersEmbed(
        answers,
        interaction,
        ticketConfig,
        pending.categoryLabel
      );
      const sent = await channel.send({ embeds: [answersEmbed] });
      await tryPinMessage(sent);
    } catch (error) {
      console.warn("Falha ao enviar respostas do formulario:", error);
      try {
        const fallback = answers
          .map(
            (a) =>
              `**${String(a.question ?? "").slice(0, 200)}**\n> ${String(a.answer ?? "").slice(0, 800) || "_sem resposta_"}`
          )
          .join("\n\n")
          .slice(0, 1800);
        await channel.send({ content: `📋 **Respostas do formulário**\n\n${fallback}` });
      } catch {}
    }
  }
}

export async function handleTicketMessageCreate(message) {
  if (!message?.guildId || !message?.channelId) return;
  if (message.author?.bot) return;

  const key = `${message.guildId}:${message.channelId}`;
  const now = Date.now();
  const last = ticketTouchAt.get(key) ?? 0;
  if (now - last < 30_000) return;
  ticketTouchAt.set(key, now);

  try {
    await Ticket.updateOne(
      { guildId: message.guildId, channelId: message.channelId, status: "open" },
      { $set: { lastActivityAt: new Date(now), autoCloseWarnedAt: null } }
    );
  } catch {}
}

async function closeTicketProgrammatically({
  client,
  guildId,
  channelId,
  ticketConfig,
  tag,
  reason
}) {
  const now = new Date();

  const ticket = await Ticket.findOne({ guildId, channelId, status: "open" });
  if (!ticket) return { ok: false, reason: "ticket_not_found" };

  ticket.status = "closed";
  ticket.closedAt = now;
  ticket.tag = tag ?? null;
  await ticket.save();

  let channel = null;
  try {
    channel = await client.channels.fetch(channelId);
  } catch {}

  if (!channel) {
    return { ok: true, reason: "channel_missing" };
  }

  let transcriptContent = "Sem mensagens.";
  let transcriptHtml = "";
  let transcriptLink = "";

  try {
    const messages = await fetchTranscriptMessages(channel);
    transcriptContent = await buildTranscriptMarkdownFromMessages(messages);
    transcriptHtml = await buildTranscriptHtml(channel, messages);

    const transcriptId = crypto.randomBytes(16).toString("hex");
    await TicketTranscript.create({
      transcriptId,
      guildId,
      channelId: channel.id,
      ownerId: ticket.ownerId,
      messageCount: messages.length,
      markdown: transcriptContent,
      html: transcriptHtml
    });

    if (config.panelBaseUrl) {
      transcriptLink = `${config.panelBaseUrl}/transcript/${transcriptId}`;
    }
  } catch (error) {
    console.error("Falha ao gerar transcript (auto-close):", error);
  }

  const attachment = new AttachmentBuilder(Buffer.from(transcriptContent, "utf8"), {
    name: `transcript-${channel.id}.md`
  });

  try {
    await channel.send({
      content: transcriptLink
        ? `Ticket fechado por inatividade. Transcript: ${transcriptLink}`
        : "Ticket fechado por inatividade. Transcript em anexo:",
      files: [attachment]
    });
  } catch {}

  let owner = null;
  try {
    owner = await client.users.fetch(ticket.ownerId);
    await owner.send({
      content: transcriptLink
        ? `Seu ticket foi fechado por inatividade. Transcript: ${transcriptLink}`
        : "Seu ticket foi fechado por inatividade. Transcript em anexo:",
      files: [attachment]
    });
  } catch {}

  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (guild) {
      const logChannel = await getOrCreateTranscriptLogChannel(guild, ticketConfig);
      if (logChannel) {
        const resolvedOwner =
          owner ?? (await client.users.fetch(ticket.ownerId).catch(() => null));
        const ownerName = resolvedOwner?.tag ?? `Usuario ${ticket.ownerId}`;
        const categoryLabel = ticket.categoryLabel ?? "Sem categoria";
        const createdAt = ticket.createdAt ?? new Date();
        const createdAtLabel = createdAt.toLocaleString("pt-BR");
        const title = `${ownerName} • ${categoryLabel} • ${createdAtLabel}`.slice(0, 256);
        const embed = {
          title,
          description: transcriptLink ? `Transcript: ${transcriptLink}` : "Transcript em anexo.",
          color: 0x2fffe0,
          fields: [
            { name: "Tag", value: tag ?? "Sem tag", inline: true },
            { name: "Motivo", value: reason ?? "inatividade", inline: true }
          ]
        };

        await logChannel.send({
          embeds: [embed],
          files: [attachment]
        });
      }
    }
  } catch (error) {
    console.warn("Falha ao enviar transcript para logs (auto-close):", error);
  }

  try {
    if (channel.isThread?.()) {
      await channel.setLocked(true);
      await channel.setArchived(true);
    } else {
      setTimeout(async () => {
        try {
          await channel.delete("Ticket fechado por inatividade");
        } catch {}
      }, 5000);
    }
  } catch {}

  return { ok: true, reason: "closed" };
}

async function warnTicketAutoClose({ client, ticket, afterMinutes, reminderMinutes }) {
  if (!ticket?.guildId || !ticket?.channelId || !ticket?.ownerId) return false;
  if (ticket.autoCloseWarnedAt) return false;

  const minutesLeft = Math.max(1, afterMinutes - reminderMinutes);

  try {
    const channel = await client.channels.fetch(ticket.channelId);
    if (!channel) return false;
    await channel.send({
      content: `<@${ticket.ownerId}> este ticket sera fechado por inatividade em ~${minutesLeft} minuto(s). Se ainda precisar, envie uma mensagem aqui.`
    });
    await Ticket.updateOne(
      { _id: ticket._id, status: "open" },
      { $set: { autoCloseWarnedAt: new Date() } }
    );
    return true;
  } catch {
    return false;
  }
}

export function startTicketAutoCloseScheduler(client) {
  if (!client) return;
  if (global._mbTicketAutoCloseSchedulerStarted) return;
  global._mbTicketAutoCloseSchedulerStarted = true;

  const tick = async () => {
    if (!client?.isReady?.()) return;

    const nowMs = Date.now();

    for (const guild of client.guilds.cache.values()) {
      const ticketConfig = await getTicketConfigForGuild(guild.id);
      const autoClose = ticketConfig.autoClose ?? {};
      if (!autoClose.enabled || !autoClose.afterMinutes) continue;

      const afterMinutes = clampInt(autoClose.afterMinutes, 0, 0, 60 * 24 * 30);
      const reminderMinutes = clampInt(autoClose.reminderMinutes, 0, 0, 60 * 24 * 30);
      if (!afterMinutes) continue;

      const closeBefore = new Date(nowMs - afterMinutes * 60 * 1000);

      try {
        if (reminderMinutes && reminderMinutes < afterMinutes) {
          const warnBefore = new Date(nowMs - reminderMinutes * 60 * 1000);
          const warnCandidates = await Ticket.find({
            guildId: guild.id,
            status: "open",
            autoCloseWarnedAt: { $in: [null, undefined] },
            $or: [
              {
                lastActivityAt: { $lte: warnBefore, $gt: closeBefore }
              },
              {
                lastActivityAt: { $exists: false },
                createdAt: { $lte: warnBefore, $gt: closeBefore }
              }
            ]
          })
            .sort({ lastActivityAt: 1, createdAt: 1 })
            .limit(10);

          for (const ticket of warnCandidates) {
            await warnTicketAutoClose({ client, ticket, afterMinutes, reminderMinutes });
          }
        }

        const closeCandidates = await Ticket.find({
          guildId: guild.id,
          status: "open",
          $or: [
            { lastActivityAt: { $lte: closeBefore } },
            { lastActivityAt: { $exists: false }, createdAt: { $lte: closeBefore } }
          ]
        })
          .sort({ lastActivityAt: 1, createdAt: 1 })
          .limit(10);

        for (const ticket of closeCandidates) {
          await closeTicketProgrammatically({
            client,
            guildId: guild.id,
            channelId: ticket.channelId,
            ticketConfig,
            tag: "auto-close",
            reason: "inatividade"
          });
        }
      } catch (error) {
        console.warn("Ticket auto-close tick failed:", error);
      }
    }
  };

  const timer = setInterval(tick, 60_000);
  timer.unref?.();
}

export async function handleTicketButton(interaction) {
  const ticket = await Ticket.findOne({ channelId: interaction.channelId });

  if (!ticket) {
    await interaction.reply({
      content: "Ticket nao encontrado.",
      ephemeral: true
    });
    return;
  }

  const ticketConfig = await getTicketConfigForGuild(interaction.guildId);

  if (interaction.customId === "ticket_claim") {
    if (!isStaff(interaction.member, ticketConfig)) {
      await interaction.reply({
        content: "Apenas staff pode assumir.",
        ephemeral: true
      });
      return;
    }

    if (ticket.claimedBy) {
      await interaction.reply({
        content: `Ja assumido por <@${ticket.claimedBy}>.`,
        ephemeral: true
      });
      return;
    }

    ticket.claimedBy = interaction.user.id;
    await ticket.save();

    await interaction.channel.send({
      content: `Ticket assumido por <@${interaction.user.id}>.`
    });

    await interaction.reply({ content: "Ticket assumido.", ephemeral: true });
    return;
  }

  if (interaction.customId === "ticket_transfer") {
    if (!isStaff(interaction.member, ticketConfig)) {
      await interaction.reply({
        content: "Apenas staff pode transferir.",
        ephemeral: true
      });
      return;
    }

    const select = new UserSelectMenuBuilder()
      .setCustomId(`ticket_transfer_select:${interaction.channelId}`)
      .setPlaceholder("Selecione o novo responsavel")
      .setMinValues(1)
      .setMaxValues(1);

    await interaction.reply({
      content: "Selecione quem vai assumir o ticket:",
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: true
    });
    return;
  }

  if (interaction.customId === "ticket_close") {
    const isOwner = interaction.user.id === ticket.ownerId;

    if (!isOwner && !isStaff(interaction.member, ticketConfig)) {
      await interaction.reply({
        content: "Voce nao pode fechar este ticket.",
        ephemeral: true
      });
      return;
    }

    if (ticket.status === "closed") {
      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.channel;
      if (channel?.isThread?.()) {
        try {
          await channel.setLocked(true);
          await channel.setArchived(true);
        } catch {}
      } else {
        setTimeout(async () => {
          try {
            await channel.delete("Ticket ja estava marcado como fechado");
          } catch {}
        }, 1500);
      }

      await interaction.editReply({
        content: "Este ticket ja estava marcado como fechado. Finalizando o canal agora."
      });
      return;
    }
    const tagSelect = new StringSelectMenuBuilder()
      .setCustomId(`ticket_close_tag:${interaction.channelId}`)
      .setPlaceholder("Selecione a tag do ticket")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(buildCloseTagOptions(ticketConfig));

    await interaction.reply({
      content: "Antes de fechar, selecione a tag do ticket:",
      components: [new ActionRowBuilder().addComponents(tagSelect)],
      ephemeral: true
    });
  }
}

export async function handleTicketCloseTagSelect(interaction) {
  const [, channelId] = interaction.customId.split(":");
  if (!channelId) {
    await interaction.reply({
      content: "Canal invalido para fechar ticket.",
      ephemeral: true
    });
    return;
  }

  const selectedTag = interaction.values?.[0] ?? "sem_tag";
  if (selectedTag === "custom") {
    const modal = new ModalBuilder()
      .setCustomId(`ticket_close_tag_form:${channelId}`)
      .setTitle("Tag personalizada");
    const input = new TextInputBuilder()
      .setCustomId("tag")
      .setLabel("Digite a tag")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(32);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  await finalizeTicketClose(interaction, channelId, selectedTag);
}

export async function handleTicketCloseTagModalSubmit(interaction) {
  const [, channelId] = interaction.customId.split(":");
  if (!channelId) {
    await interaction.reply({
      content: "Canal invalido para fechar ticket.",
      ephemeral: true
    });
    return;
  }

  const tagValue = interaction.fields.getTextInputValue("tag");
  await finalizeTicketClose(interaction, channelId, tagValue);
}

export async function handleTicketTransferSelect(interaction) {
  const [, channelId] = interaction.customId.split(":");
  const ticket = await Ticket.findOne({ channelId });

  if (!ticket) {
    await interaction.reply({
      content: "Ticket nao encontrado.",
      ephemeral: true
    });
    return;
  }

  const ticketConfig = await getTicketConfigForGuild(interaction.guildId);

  if (!isStaff(interaction.member, ticketConfig)) {
    await interaction.reply({
      content: "Apenas staff pode transferir.",
      ephemeral: true
    });
    return;
  }

  const newOwnerId = interaction.values?.[0];
  if (!newOwnerId) return;

  ticket.claimedBy = newOwnerId;
  await ticket.save();

  await interaction.channel.send({
    content: `Ticket transferido para <@${newOwnerId}>.`
  });

  await interaction.reply({ content: "Transferido.", ephemeral: true });
}

export function updateCategories(ticketConfig, action, payload) {
  const categories = ticketConfig.categories ?? [];

  if (action === "add") {
    const label = payload.label?.trim();
    if (!label) return { changed: false, reason: "Label invalido." };

    const normalized = normalizeLabel(label);
    if (categories.some((cat) => normalizeLabel(cat.label) === normalized)) {
      return { changed: false, reason: "Categoria ja existe." };
    }

    if (categories.length >= 25) {
      return { changed: false, reason: "Limite de 25 categorias." };
    }

    categories.push({
      label,
      description: payload.description?.trim() || undefined
    });

    ticketConfig.categories = categories;
    return { changed: true };
  }

  if (action === "remove") {
    const target = normalizeLabel(payload.label);
    const next = categories.filter(
      (cat) => normalizeLabel(cat.label) !== target
    );

    if (next.length === categories.length) {
      return { changed: false, reason: "Categoria nao encontrada." };
    }

    ticketConfig.categories = next;
    return { changed: true };
  }

  return { changed: false, reason: "Acao invalida." };
}

export function formatConfigSummary(ticketConfig) {
  const lines = [];
  lines.push(`Tipo: ${ticketConfig.type}`);
  lines.push(
    `Canal de abertura: ${ticketConfig.openChannelId ? `<#${ticketConfig.openChannelId}>` : "(nao definido)"}`
  );
  lines.push("Categoria de canal: automatica (tickets-<categoria>)");
  const ac = ticketConfig.autoClose ?? {};
  lines.push(
    `Auto-close: ${ac.enabled ? `ativo (apos ${ac.afterMinutes} min${ac.reminderMinutes ? `, lembrete ${ac.reminderMinutes} min` : ""})` : "desativado"}`
  );
  lines.push(
    `Cargos staff: ${ticketConfig.staffRoleIds?.length ? ticketConfig.staffRoleIds.map((id) => `<@&${id}>`).join(" ") : "(nenhum)"}`
  );
  lines.push(
    `Categorias: ${ticketConfig.categories?.length ? ticketConfig.categories.map((cat) => cat.label).join(", ") : "(nenhuma)"}`
  );
  lines.push(
    "Obs: threads herdam permissoes do canal de abertura."
  );
  return lines.join("\n");
}
