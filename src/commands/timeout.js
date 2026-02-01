import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import {
  getModerationConfig,
  logModerationAction,
  recordInfraction
} from "../moderation/moderationService.js";

const MAX_TIMEOUT_MINUTES = 40320;

const data = new SlashCommandBuilder()
  .setName("timeout")
  .setDescription("Aplica timeout em um usuario")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option.setName("usuario").setDescription("Usuario alvo").setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName("minutos")
      .setDescription("Duracao do timeout em minutos")
      .setMinValue(1)
      .setMaxValue(MAX_TIMEOUT_MINUTES)
      .setRequired(true)
  )
  .addStringOption((option) =>
    option.setName("motivo").setDescription("Motivo do timeout")
  );

function hasPermission(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers);
}

export default {
  data,
  async execute(interaction) {
    if (!hasPermission(interaction)) {
      await interaction.reply({
        content: "Voce precisa de Moderate Members para usar este comando.",
        ephemeral: true
      });
      return;
    }

    const user = interaction.options.getUser("usuario", true);
    const minutes = interaction.options.getInteger("minutos", true);
    const reason =
      interaction.options.getString("motivo") || "Sem motivo informado";

    if (user.id === interaction.user.id) {
      await interaction.reply({
        content: "Voce nao pode aplicar timeout em voce mesmo.",
        ephemeral: true
      });
      return;
    }

    if (user.id === interaction.client.user.id) {
      await interaction.reply({
        content: "Voce nao pode aplicar timeout no bot.",
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

    if (!member.moderatable) {
      await interaction.editReply({
        content: "Nao posso aplicar timeout neste usuario."
      });
      return;
    }

    const durationMs = minutes * 60 * 1000;

    try {
      await member.timeout(durationMs, reason);
    } catch (error) {
      console.error("Falha ao aplicar timeout:", error);
      await interaction.editReply({
        content: "Falha ao aplicar timeout."
      });
      return;
    }

    try {
      await user.send(
        `Voce recebeu timeout em ${interaction.guild.name} por ${minutes}m. Motivo: ${reason}`
      );
    } catch {
      // Ignora falha de DM
    }

    await recordInfraction({
      guildId: interaction.guildId,
      userId: user.id,
      moderatorId: interaction.user.id,
      type: "timeout",
      reason,
      durationMs
    });

    const config = await getModerationConfig(interaction.guildId);
    await logModerationAction({
      guild: interaction.guild,
      config,
      title: "Timeout aplicado",
      description: reason,
      fields: [
        { name: "Usuario", value: `<@${user.id}> (${user.id})`, inline: true },
        { name: "Duracao", value: `${minutes}m`, inline: true },
        { name: "Moderador", value: `<@${interaction.user.id}>`, inline: true }
      ],
      color: 0xffb347
    });

    await interaction.editReply({
      content: `Timeout aplicado em ${user.tag} por ${minutes} minutos.`
    });
  }
};
