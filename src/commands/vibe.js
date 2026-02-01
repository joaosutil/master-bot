import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";

import { postVibeCheckNow } from "../services/vibeCheckService.js";
import { getOrCreateGuildConfigDoc, saveGuildConfigDoc } from "../services/guildConfigService.js";

const data = new SlashCommandBuilder()
  .setName("vibe")
  .setDescription("Vibe Check: botão divertido + gêmeo de vibe")
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName("postar")
      .setDescription("Posta o Vibe Check de hoje")
      .addChannelOption((opt) =>
        opt
          .setName("canal")
          .setDescription("Canal onde o Vibe Check será postado")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("desativar")
      .setDescription("Desativa o Vibe Check automático")
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Mostra o status/configuração atual")
  );

function hasManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

export default {
  data,
  async execute(interaction, { client } = {}) {
    if (!hasManageGuild(interaction)) {
      await interaction.reply({
        content: "Você precisa de Manage Guild para usar isso.",
        ephemeral: true
      });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "desativar") {
      const config = await getOrCreateGuildConfigDoc(interaction.guildId);
      if (!config.vibeCheck) config.vibeCheck = {};
      config.vibeCheck.enabled = false;
      await saveGuildConfigDoc(config);
      await interaction.reply({
        content: "Vibe Check desativado. (Mensagens antigas continuam lá.)",
        ephemeral: true
      });
      return;
    }

    if (sub === "status") {
      const config = await getOrCreateGuildConfigDoc(interaction.guildId);
      const vibe = config.vibeCheck || {};
      await interaction.reply({
        content:
          `**Vibe Check:** ${vibe.enabled ? "Ativo" : "Desativado"}\n` +
          `Canal: ${vibe.channelId ? `<#${vibe.channelId}>` : "(não definido)"}\n` +
          `Hora (UTC): ${Number.isFinite(vibe.hour) ? vibe.hour : "(padrão 20)"}`,
        ephemeral: true
      });
      return;
    }

    if (sub === "postar") {
      const channel = interaction.options.getChannel("canal", true);
      if (!client) {
        await interaction.reply({
          content: "Cliente do bot indisponível para postar.",
          ephemeral: true
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const { messageId } = await postVibeCheckNow(client, interaction.guildId, {
        channelIdOverride: channel.id
      });

      const link = `https://discord.com/channels/${interaction.guildId}/${channel.id}/${messageId}`;
      await interaction.editReply(`Vibe Check postado: ${link}`);
    }
  }
};

