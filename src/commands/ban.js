import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import {
  getModerationConfig,
  logModerationAction,
  recordInfraction
} from "../moderation/moderationService.js";

const data = new SlashCommandBuilder()
  .setName("ban")
  .setDescription("Bane um usuario do servidor")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addUserOption((option) =>
    option.setName("usuario").setDescription("Usuario alvo").setRequired(true)
  )
  .addStringOption((option) =>
    option.setName("motivo").setDescription("Motivo do banimento")
  );

function hasPermission(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers);
}

export default {
  data,
  async execute(interaction) {
    if (!hasPermission(interaction)) {
      await interaction.reply({
        content: "Voce precisa de Ban Members para usar este comando.",
        ephemeral: true
      });
      return;
    }

    const user = interaction.options.getUser("usuario", true);
    const reason =
      interaction.options.getString("motivo") || "Sem motivo informado";

    if (user.id === interaction.user.id) {
      await interaction.reply({
        content: "Voce nao pode se banir.",
        ephemeral: true
      });
      return;
    }

    if (user.id === interaction.client.user.id) {
      await interaction.reply({
        content: "Voce nao pode banir o bot.",
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const member = await interaction.guild.members
      .fetch(user.id)
      .catch(() => null);

    if (member && !member.bannable) {
      await interaction.editReply({
        content: "Nao posso banir este usuario (hierarquia/permissoes)."
      });
      return;
    }

    try {
      await interaction.guild.members.ban(user.id, { reason });
    } catch (error) {
      console.error("Falha ao banir:", error);
      await interaction.editReply({ content: "Falha ao banir o usuario." });
      return;
    }

    try {
      await user.send(
        `Voce foi banido de ${interaction.guild.name}. Motivo: ${reason}`
      );
    } catch {
      // Ignora falha de DM
    }

    await recordInfraction({
      guildId: interaction.guildId,
      userId: user.id,
      moderatorId: interaction.user.id,
      type: "ban",
      reason
    });

    const config = await getModerationConfig(interaction.guildId);
    await logModerationAction({
      guild: interaction.guild,
      config,
      title: "Banimento aplicado",
      description: reason,
      fields: [
        { name: "Usuario", value: `<@${user.id}> (${user.id})`, inline: true },
        { name: "Moderador", value: `<@${interaction.user.id}>`, inline: true }
      ],
      color: 0xff7b7b
    });

    await interaction.editReply({
      content: `Usuario banido: ${user.tag}`
    });
  }
};
