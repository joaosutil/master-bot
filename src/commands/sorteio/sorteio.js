import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";

import {
  cancelGiveawayByMessage,
  createGiveaway,
  endGiveawayByMessage,
  parseDurationMs,
  parseMessageLinkOrId
} from "../../giveaway/giveawayService.js";

function sanitizeMention(s) {
  const v = String(s ?? "").trim();
  if (!v) return null;
  if (v === "@everyone" || v === "@here") return v;
  if (/^<@&\d+>$/.test(v)) return v;
  return null;
}

const data = new SlashCommandBuilder()
  .setName("sorteio")
  .setDescription("Cria e gerencia sorteios")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc
      .setName("criar")
      .setDescription("Cria um sorteio com botão de participação")
      .addStringOption((o) =>
        o.setName("premio").setDescription("Prêmio do sorteio").setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName("duracao")
          .setDescription('Duração (ex: "10m", "2h", "1d2h", "30s")')
          .setRequired(true)
      )
      .addIntegerOption((o) =>
        o
          .setName("vencedores")
          .setDescription("Quantidade de vencedores")
          .setMinValue(1)
          .setMaxValue(20)
      )
      .addChannelOption((o) =>
        o
          .setName("canal")
          .setDescription("Canal onde o sorteio será postado (padrão: canal atual)")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addStringOption((o) =>
        o.setName("titulo").setDescription("Título do embed (opcional)")
      )
      .addStringOption((o) =>
        o.setName("descricao").setDescription("Descrição extra (opcional)")
      )
      .addStringOption((o) =>
        o
          .setName("mencao")
          .setDescription('Menção no post (ex: "@everyone" ou "<@&cargo>")')
      )
      .addRoleOption((o) =>
        o
          .setName("cargo_requisito")
          .setDescription("Cargo necessário para participar (opcional)")
      )
      .addRoleOption((o) =>
        o
          .setName("cargo_bloqueado")
          .setDescription("Quem tiver esse cargo NÃO pode participar (opcional)")
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("encerrar")
      .setDescription("Encerra um sorteio e sorteia vencedores")
      .addStringOption((o) =>
        o
          .setName("mensagem")
          .setDescription("Link da mensagem do sorteio ou ID da mensagem")
          .setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName("canal")
          .setDescription("Canal da mensagem (se você passar só o ID)")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("reroll")
      .setDescription("Rerolla (sorteia novos vencedores) de um sorteio já encerrado")
      .addStringOption((o) =>
        o
          .setName("mensagem")
          .setDescription("Link da mensagem do sorteio ou ID da mensagem")
          .setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName("canal")
          .setDescription("Canal da mensagem (se você passar só o ID)")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("cancelar")
      .setDescription("Cancela um sorteio (sem vencedores)")
      .addStringOption((o) =>
        o
          .setName("mensagem")
          .setDescription("Link da mensagem do sorteio ou ID da mensagem")
          .setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName("canal")
          .setDescription("Canal da mensagem (se você passar só o ID)")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
  );

export default {
  data,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand(true);

    if (sub === "criar") {
      const prize = interaction.options.getString("premio", true);
      const durationRaw = interaction.options.getString("duracao", true);
      const durationMs = parseDurationMs(durationRaw);
      const winnersCount = interaction.options.getInteger("vencedores") ?? 1;

      const channel = interaction.options.getChannel("canal") ?? interaction.channel;
      const title = interaction.options.getString("titulo");
      const description = interaction.options.getString("descricao");

      const mentionRaw = interaction.options.getString("mencao");
      const mention = mentionRaw ? sanitizeMention(mentionRaw) : null;
      if (mentionRaw && !mention) {
        return interaction.reply({
          content: 'Menção inválida. Use "@everyone", "@here" ou uma menção de cargo tipo "<@&123>".',
          ephemeral: true
        });
      }

      const requiredRole = interaction.options.getRole("cargo_requisito");
      const blockedRole = interaction.options.getRole("cargo_bloqueado");

      if (!durationMs) {
        return interaction.reply({
          content: 'Duração inválida. Exemplos: "10m", "2h", "1d2h", "30s".',
          ephemeral: true
        });
      }
      if (durationMs < 10_000) {
        return interaction.reply({
          content: "Duração muito curta. Use pelo menos 10s.",
          ephemeral: true
        });
      }
      if (durationMs > 30 * 24 * 60 * 60 * 1000) {
        return interaction.reply({
          content: "Duração muito longa. Máximo: 30 dias.",
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const { giveaway, message } = await createGiveaway({
        client: interaction.client,
        guildId: interaction.guildId,
        channelId: channel.id,
        hostId: interaction.user.id,
        prize,
        winnersCount,
        durationMs,
        title,
        description,
        mention,
        requiredRoleId: requiredRole?.id ?? null,
        blockedRoleId: blockedRole?.id ?? null
      });

      await interaction.editReply({
        content: `✅ Sorteio criado!\nMensagem: ${message.url}\nID: \`${giveaway.messageId}\``
      });
      return;
    }

    const msgInput = interaction.options.getString("mensagem", true);
    const ref = parseMessageLinkOrId(msgInput);
    if (!ref) {
      return interaction.reply({
        content: "Não entendi essa mensagem. Envie o link da mensagem ou o ID.",
        ephemeral: true
      });
    }

    const channelOpt = interaction.options.getChannel("canal");
    const channelId = ref.channelId ?? channelOpt?.id ?? null;
    if (!channelId) {
      return interaction.reply({
        content: "Se você passar só o ID, precisa informar também o canal.",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    if (sub === "encerrar") {
      const res = await endGiveawayByMessage({
        client: interaction.client,
        guildId: interaction.guildId,
        channelId,
        messageId: ref.messageId,
        endedById: interaction.user.id,
        mode: "end"
      });

      if (!res.ok) {
        await interaction.editReply({ content: `❌ Não foi possível encerrar: ${res.reason}` });
        return;
      }

      const winnerText = res.winners.length ? res.winners.map((id) => `<@${id}>`).join(", ") : "ninguém 😭";
      await interaction.editReply({ content: `✅ Sorteio encerrado!\nVencedores: ${winnerText}` });
      return;
    }

    if (sub === "reroll") {
      const res = await endGiveawayByMessage({
        client: interaction.client,
        guildId: interaction.guildId,
        channelId,
        messageId: ref.messageId,
        endedById: interaction.user.id,
        mode: "reroll"
      });

      if (!res.ok) {
        await interaction.editReply({ content: `❌ Não foi possível rerollar: ${res.reason}` });
        return;
      }

      const winnerText = res.winners.length ? res.winners.map((id) => `<@${id}>`).join(", ") : "ninguém 😭";
      await interaction.editReply({ content: `✅ Reroll feito!\nNovos vencedores: ${winnerText}` });
      return;
    }

    if (sub === "cancelar") {
      const res = await cancelGiveawayByMessage({
        client: interaction.client,
        guildId: interaction.guildId,
        channelId,
        messageId: ref.messageId,
        canceledById: interaction.user.id
      });

      if (!res.ok) {
        await interaction.editReply({ content: `❌ Não foi possível cancelar: ${res.reason}` });
        return;
      }

      await interaction.editReply({ content: "✅ Sorteio cancelado." });
    }
  }
};

