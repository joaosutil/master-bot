import {
  ChannelType,
  Collection,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";

function clampInt(n, min, max) {
  const v = Number.isFinite(n) ? Math.trunc(n) : min;
  return Math.max(min, Math.min(max, v));
}

async function collectMessagesToDelete(channel, { amount, userId, includePinned }) {
  const wanted = clampInt(amount, 1, 100);
  const picked = [];

  let before;
  for (let round = 0; round < 10 && picked.length < wanted; round++) {
    const fetched = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!fetched?.size) break;

    for (const msg of fetched.values()) {
      before = msg.id;
      if (!includePinned && msg.pinned) continue;
      if (userId && msg.author?.id !== userId) continue;

      picked.push(msg);
      if (picked.length >= wanted) break;
    }

    before = fetched.last()?.id;
    if (!before) break;
  }

  return picked;
}

const data = new SlashCommandBuilder()
  .setName("limpar")
  .setDescription("Limpa mensagens do chat (até 100 por vez)")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addIntegerOption((o) =>
    o
      .setName("quantidade")
      .setDescription("Quantas mensagens apagar (1 a 100)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100)
  )
  .addUserOption((o) =>
    o.setName("usuario").setDescription("Apaga somente mensagens deste usuário")
  )
  .addBooleanOption((o) =>
    o
      .setName("fixadas")
      .setDescription("Se true, inclui mensagens fixadas (padrão: false)")
  )
  .addChannelOption((o) =>
    o
      .setName("canal")
      .setDescription("Canal alvo (padrão: canal atual)")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );

export default {
  data,
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.inGuild()) {
      await interaction.editReply({ content: "❌ Esse comando só funciona em servidores." });
      return;
    }

    const channel = interaction.options.getChannel("canal") ?? interaction.channel;
    if (!channel?.isTextBased?.() || typeof channel.bulkDelete !== "function") {
      await interaction.editReply({ content: "❌ Esse canal não suporta limpeza de mensagens." });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.editReply({ content: "❌ Você precisa da permissão **Gerenciar Mensagens**." });
      return;
    }

    const amount = interaction.options.getInteger("quantidade", true);
    const user = interaction.options.getUser("usuario");
    const includePinned = interaction.options.getBoolean("fixadas") ?? false;

    const picked = await collectMessagesToDelete(channel, {
      amount,
      userId: user?.id ?? null,
      includePinned
    });

    if (!picked.length) {
      await interaction.editReply({ content: "✅ Nada para limpar." });
      return;
    }

    const col = new Collection(picked.map((m) => [m.id, m]));
    const deleted = await channel.bulkDelete(col, true);

    const deletedCount = deleted?.size ?? 0;
    const requested = col.size;
    const skipped = Math.max(0, requested - deletedCount);

    const extra =
      skipped > 0
        ? `\n⚠️ ${skipped} mensagem(ns) não puderam ser apagadas (ex.: mais de 14 dias).`
        : "";

    await interaction.editReply({
      content: `✅ Apaguei **${deletedCount}** mensagem(ns) em ${channel}.${extra}`
    });
  }
};

