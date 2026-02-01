import mongoose from "mongoose";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { Giveaway } from "./giveawayModel.js";

function isMongoConnected() {
  return mongoose.connection?.readyState === 1;
}

export function parseDurationMs(input) {
  const s = String(input ?? "").trim().toLowerCase();
  const re = /(\d+)\s*(d|h|m|s)\b/g;

  let ms = 0;
  let matched = false;
  for (const m of s.matchAll(re)) {
    matched = true;
    const n = Number(m[1]);
    const unit = m[2];
    if (!Number.isFinite(n) || n <= 0) continue;
    if (unit === "d") ms += n * 24 * 60 * 60 * 1000;
    if (unit === "h") ms += n * 60 * 60 * 1000;
    if (unit === "m") ms += n * 60 * 1000;
    if (unit === "s") ms += n * 1000;
  }

  return matched && ms > 0 ? ms : null;
}

export function parseMessageLinkOrId(input) {
  const s = String(input ?? "").trim();
  const linkRe = /channels\/(\d+)\/(\d+)\/(\d+)/;
  const m = s.match(linkRe);
  if (m) return { channelId: m[2], messageId: m[3] };

  const idRe = /^\d{10,30}$/;
  if (idRe.test(s)) return { channelId: null, messageId: s };

  return null;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickWinners(participants, winnersCount) {
  const uniq = [...new Set(participants)];
  const shuffled = shuffle(uniq);
  return shuffled.slice(0, Math.max(0, winnersCount));
}

function giveawayEmbed(g, { ended = false } = {}) {
  const endsUnix = Math.floor(new Date(g.endsAt).getTime() / 1000);
  const req = [];
  if (g.requiredRoleId) req.push(`✅ Cargo: <@&${g.requiredRoleId}>`);
  if (g.blockedRoleId) req.push(`🚫 Sem cargo: <@&${g.blockedRoleId}>`);

  const e = new EmbedBuilder()
    .setTitle(ended ? "🏁 Sorteio encerrado" : (g.title ?? "🎉 Sorteio"))
    .setDescription(
      [
        g.description ? String(g.description) : null,
        `**Prêmio:** ${g.prize}`,
        `**Vencedores:** ${g.winnersCount}`,
        ended ? null : `**Termina:** <t:${endsUnix}:R> • <t:${endsUnix}:f>`,
        `**Participantes:** ${g.participants?.length ?? 0}`,
        req.length ? `\n${req.join("\n")}` : null
      ].filter(Boolean).join("\n")
    )
    .setFooter({ text: `Host: ${g.hostId}` });

  return e;
}

function giveawayRow(g, { ended = false } = {}) {
  const join = new ButtonBuilder()
    .setCustomId(`sorteio_join:${g._id}`)
    .setLabel("Participar")
    .setStyle(ButtonStyle.Success)
    .setDisabled(ended);

  const leave = new ButtonBuilder()
    .setCustomId(`sorteio_leave:${g._id}`)
    .setLabel("Sair")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(ended);

  return new ActionRowBuilder().addComponents(join, leave);
}

export async function createGiveaway({
  client,
  guildId,
  channelId,
  hostId,
  prize,
  winnersCount = 1,
  durationMs,
  title,
  description,
  mention,
  requiredRoleId,
  blockedRoleId
}) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased?.()) {
    throw new Error("Canal inválido (precisa ser canal de texto).");
  }

  const endsAt = new Date(Date.now() + durationMs);

  const g = await Giveaway.create({
    guildId,
    channelId,
    messageId: "pending",
    hostId,
    prize,
    winnersCount,
    title: title ?? "🎉 Sorteio",
    description: description ?? null,
    mention: mention ?? null,
    requiredRoleId: requiredRoleId ?? null,
    blockedRoleId: blockedRoleId ?? null,
    endsAt
  });

  const msg = await channel.send({
    content: g.mention ?? null,
    embeds: [giveawayEmbed(g)],
    components: [giveawayRow(g)]
  });

  g.messageId = msg.id;
  await g.save();

  return { giveaway: g, message: msg };
}

export async function handleGiveawayButton(interaction) {
  if (!isMongoConnected()) {
    return interaction.reply({ content: "MongoDB não conectado.", ephemeral: true });
  }

  const [action, giveawayId] = String(interaction.customId).split(":");
  if (!giveawayId) return;

  const g = await Giveaway.findById(giveawayId);
  if (!g) return interaction.reply({ content: "Sorteio não encontrado.", ephemeral: true });

  if (g.endedAt || Date.now() >= new Date(g.endsAt).getTime()) {
    try {
      await interaction.message.edit({
        embeds: [giveawayEmbed(g, { ended: true })],
        components: [giveawayRow(g, { ended: true })]
      });
    } catch {}
    return interaction.reply({ content: "Esse sorteio já acabou.", ephemeral: true });
  }

  const member = interaction.member;
  const roles = member?.roles;
  const hasRole = (roleId) => Boolean(roles?.cache?.has?.(roleId));

  if (g.requiredRoleId && !hasRole(g.requiredRoleId)) {
    return interaction.reply({ content: "Você não tem o cargo necessário para participar.", ephemeral: true });
  }
  if (g.blockedRoleId && hasRole(g.blockedRoleId)) {
    return interaction.reply({ content: "Você não pode participar (cargo bloqueado).", ephemeral: true });
  }

  await interaction.deferUpdate();

  if (action === "sorteio_join") {
    await Giveaway.updateOne(
      { _id: g._id },
      { $addToSet: { participants: interaction.user.id } }
    );
    const updated = await Giveaway.findById(g._id).lean();
    try {
      await interaction.message.edit({
        embeds: [giveawayEmbed(updated)],
        components: [giveawayRow(updated)]
      });
    } catch {}
    await interaction.followUp({ content: "✅ Você entrou no sorteio!", ephemeral: true });
    return;
  }

  if (action === "sorteio_leave") {
    await Giveaway.updateOne(
      { _id: g._id },
      { $pull: { participants: interaction.user.id } }
    );
    const updated = await Giveaway.findById(g._id).lean();
    try {
      await interaction.message.edit({
        embeds: [giveawayEmbed(updated)],
        components: [giveawayRow(updated)]
      });
    } catch {}
    await interaction.followUp({ content: "✅ Você saiu do sorteio.", ephemeral: true });
    return;
  }
}

export async function endGiveawayByMessage({ client, guildId, channelId, messageId, endedById, mode = "end" }) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const g = await Giveaway.findOne({ guildId, channelId, messageId });
  if (!g) throw new Error("Não achei esse sorteio no banco.");

  if (g.endedAt && mode !== "reroll") {
    return { ok: false, reason: "already_ended", giveaway: g };
  }

  if (mode === "reroll" && !g.endedAt) {
    return { ok: false, reason: "not_ended", giveaway: g };
  }

  const winners = pickWinners(g.participants ?? [], g.winnersCount);

  if (mode === "end") {
    g.endedAt = new Date();
  }
  g.winners = winners;
  await g.save();

  const channel = await client.channels.fetch(channelId);
  const msg = await channel.messages.fetch(messageId);

  await msg.edit({
    embeds: [giveawayEmbed(g, { ended: true })],
    components: [giveawayRow(g, { ended: true })]
  });

  const winnerText = winners.length ? winners.map((id) => `<@${id}>`).join(", ") : "ninguém 😭";
  const prefix = mode === "reroll" ? "🔁 Novo sorteio (reroll)!" : "🎉 Sorteio encerrado!";
  await channel.send(`${prefix}\n**Prêmio:** ${g.prize}\n**Vencedores:** ${winnerText}`);

  return { ok: true, giveaway: g, winners };
}

export async function cancelGiveawayByMessage({ client, guildId, channelId, messageId, canceledById }) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const g = await Giveaway.findOne({ guildId, channelId, messageId });
  if (!g) throw new Error("Não achei esse sorteio no banco.");

  if (g.endedAt) {
    return { ok: false, reason: "already_ended", giveaway: g };
  }

  g.endedAt = new Date();
  g.winners = [];
  await g.save();

  const channel = await client.channels.fetch(channelId);
  const msg = await channel.messages.fetch(messageId);

  const e = giveawayEmbed(g, { ended: true }).setTitle("🛑 Sorteio cancelado");

  await msg.edit({
    embeds: [e],
    components: [giveawayRow(g, { ended: true })]
  });

  await channel.send(`🛑 Sorteio cancelado por <@${canceledById}>.\n**Prêmio:** ${g.prize}`);
  return { ok: true, giveaway: g };
}

export function startGiveawayScheduler(client, { intervalMs = 15_000 } = {}) {
  setInterval(async () => {
    if (!isMongoConnected()) return;

    const now = new Date();
    const due = await Giveaway.find({ endedAt: null, endsAt: { $lte: now }, messageId: { $ne: "pending" } })
      .sort({ endsAt: 1 })
      .limit(10)
      .lean();

    for (const g of due) {
      try {
        // marca como encerrado antes de mexer no Discord (evita dupla execução)
        const updated = await Giveaway.findOneAndUpdate(
          { _id: g._id, endedAt: null },
          { $set: { endedAt: now, winners: pickWinners(g.participants ?? [], g.winnersCount) } },
          { new: true }
        ).lean();
        if (!updated) continue;

        const winners = updated.winners ?? [];
        const channel = await client.channels.fetch(updated.channelId);
        if (!channel?.isTextBased?.()) continue;

        const msg = await channel.messages.fetch(updated.messageId);
        await msg.edit({
          embeds: [giveawayEmbed(updated, { ended: true })],
          components: [giveawayRow(updated, { ended: true })]
        });

        const winnerText = winners.length ? winners.map((id) => `<@${id}>`).join(", ") : "ninguém 😭";
        await channel.send(`🎉 Sorteio encerrado!\n**Prêmio:** ${updated.prize}\n**Vencedores:** ${winnerText}`);
      } catch (err) {
        console.error("[giveawayScheduler] erro ao encerrar sorteio:", err);
      }
    }
  }, intervalMs).unref?.();
}
