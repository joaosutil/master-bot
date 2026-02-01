import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import {
  getModerationConfig,
  logModerationAction,
  recordInfraction
} from "../moderation/moderationService.js";

const DEFAULT_MINUTES = 10;
const MAX_TIMEOUT_MINUTES = 40320;

const data = new SlashCommandBuilder()
  .setName("mute")
  .setDescription("Silencia um usuario (timeout)")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option.setName("usuario").setDescription("Usuario alvo").setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName("minutos")
      .setDescription("Duracao do mute em minutos")
      .setMinValue(1)
      .setMaxValue(MAX_TIMEOUT_MINUTES)
      .setRequired(false)
  )
  .addStringOption((option) =>
    option.setName("motivo").setDescription("Motivo do mute")
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
    const minutes =
      interaction.options.getInteger("minutos") ?? DEFAULT_MINUTES;
    const reason =
      interaction.options.getString("motivo") || "Sem motivo informado";

    if (user.id === interaction.user.id) {
      await interaction.reply({
        content: "Voce nao pode aplicar mute em voce mesmo.",
        ephemeral: true
      });
      return;
    }

    if (user.id === interaction.client.user.id) {
      await interaction.reply({
        content: "Voce nao pode aplicar mute no bot.",
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
        content: "Nao posso aplicar mute neste usuario."
      });
      return;
    }

    const durationMs = minutes * 60 * 1000;

    try {
      await member.timeout(durationMs, reason);
    } catch (error) {
      console.error("Falha ao aplicar mute:", error);
      await interaction.editReply({
        content: "Falha ao aplicar mute."
      });
      return;
    }

    try {
      await user.send(
        `Voce foi silenciado em ${interaction.guild.name} por ${minutes}m. Motivo: ${reason}`
      );
    } catch {
      // Ignora falha de DM
    }

    await recordInfraction({
      guildId: interaction.guildId,
      userId: user.id,
      moderatorId: interaction.user.id,
      type: "mute",
      reason,
      durationMs
    });

    const config = await getModerationConfig(interaction.guildId);
    await logModerationAction({
      guild: interaction.guild,
      config,
      title: "Mute aplicado",
      description: reason,
      fields: [
        { name: "Usuario", value: `<@${user.id}> (${user.id})`, inline: true },
        { name: "Duracao", value: `${minutes}m`, inline: true },
        { name: "Moderador", value: `<@${interaction.user.id}>`, inline: true }
      ],
      color: 0xffb347
    });

    await interaction.editReply({
      content: `Mute aplicado em ${user.tag} por ${minutes} minutos.`
    });
  }
};
