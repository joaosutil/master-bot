import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import {
  getModerationConfig,
  logModerationAction,
  recordInfraction
} from "../moderation/moderationService.js";

const data = new SlashCommandBuilder()
  .setName("warn")
  .setDescription("Aplica advertencia em um usuario")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addUserOption((option) =>
    option.setName("usuario").setDescription("Usuario alvo").setRequired(true)
  )
  .addStringOption((option) =>
    option.setName("motivo").setDescription("Motivo da advertencia")
  );

function hasPermission(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
}

export default {
  data,
  async execute(interaction) {
    if (!hasPermission(interaction)) {
      await interaction.reply({
        content: "Voce precisa de Manage Messages para usar este comando.",
        ephemeral: true
      });
      return;
    }

    const user = interaction.options.getUser("usuario", true);
    const reason =
      interaction.options.getString("motivo") || "Sem motivo informado";

    if (user.id === interaction.user.id) {
      await interaction.reply({
        content: "Voce nao pode advertir voce mesmo.",
        ephemeral: true
      });
      return;
    }

    if (user.id === interaction.client.user.id) {
      await interaction.reply({
        content: "Voce nao pode advertir o bot.",
        ephemeral: true
      });
      return;
    }

    await recordInfraction({
      guildId: interaction.guildId,
      userId: user.id,
      moderatorId: interaction.user.id,
      type: "warn",
      reason
    });

    try {
      await user.send(
        `Voce recebeu uma advertencia em ${interaction.guild.name}. Motivo: ${reason}`
      );
    } catch {
      // Ignora falha de DM
    }

    const config = await getModerationConfig(interaction.guildId);
    await logModerationAction({
      guild: interaction.guild,
      config,
      title: "Advertencia aplicada",
      description: reason,
      fields: [
        { name: "Usuario", value: `<@${user.id}> (${user.id})`, inline: true },
        { name: "Moderador", value: `<@${interaction.user.id}>`, inline: true }
      ],
      color: 0xf2b356
    });

    await interaction.reply({
      content: `Advertencia registrada para ${user.tag}.`,
      ephemeral: true
    });
  }
};
