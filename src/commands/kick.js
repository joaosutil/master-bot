import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import {
  getModerationConfig,
  logModerationAction,
  recordInfraction
} from "../moderation/moderationService.js";

const data = new SlashCommandBuilder()
  .setName("kick")
  .setDescription("Expulsa um usuario do servidor")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .addUserOption((option) =>
    option.setName("usuario").setDescription("Usuario alvo").setRequired(true)
  )
  .addStringOption((option) =>
    option.setName("motivo").setDescription("Motivo da expulsao")
  );

function hasPermission(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers);
}

export default {
  data,
  async execute(interaction) {
    if (!hasPermission(interaction)) {
      await interaction.reply({
        content: "Voce precisa de Kick Members para usar este comando.",
        ephemeral: true
      });
      return;
    }

    const user = interaction.options.getUser("usuario", true);
    const reason =
      interaction.options.getString("motivo") || "Sem motivo informado";

    if (user.id === interaction.user.id) {
      await interaction.reply({
        content: "Voce nao pode se expulsar.",
        ephemeral: true
      });
      return;
    }

    if (user.id === interaction.client.user.id) {
      await interaction.reply({
        content: "Voce nao pode expulsar o bot.",
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const member = await interaction.guild.members
      .fetch(user.id)
      .catch(() => null);

    if (!member) {
      await interaction.editReply({ content: "Usuario nao encontrado." });
      return;
    }

    if (!member.kickable) {
      await interaction.editReply({
        content: "Nao posso expulsar este usuario (hierarquia/permissoes)."
      });
      return;
    }

    try {
      await member.kick(reason);
    } catch (error) {
      console.error("Falha ao expulsar:", error);
      await interaction.editReply({ content: "Falha ao expulsar o usuario." });
      return;
    }

    try {
      await user.send(
        `Voce foi expulso de ${interaction.guild.name}. Motivo: ${reason}`
      );
    } catch {
      // Ignora falha de DM
    }

    await recordInfraction({
      guildId: interaction.guildId,
      userId: user.id,
      moderatorId: interaction.user.id,
      type: "kick",
      reason
    });

    const config = await getModerationConfig(interaction.guildId);
    await logModerationAction({
      guild: interaction.guild,
      config,
      title: "Expulsao aplicada",
      description: reason,
      fields: [
        { name: "Usuario", value: `<@${user.id}> (${user.id})`, inline: true },
        { name: "Moderador", value: `<@${interaction.user.id}>`, inline: true }
      ],
      color: 0xffb347
    });

    await interaction.editReply({
      content: `Usuario expulso: ${user.tag}`
    });
  }
};
