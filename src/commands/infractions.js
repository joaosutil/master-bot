import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import Infraction from "../models/Infraction.js";

const data = new SlashCommandBuilder()
  .setName("infractions")
  .setDescription("Mostra historico de infracoes de um usuario")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addUserOption((option) =>
    option.setName("usuario").setDescription("Usuario alvo").setRequired(true)
  );

function hasPermission(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
}

function formatDuration(durationMs) {
  if (!durationMs) return "";
  const minutes = Math.round(durationMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
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
    await interaction.deferReply({ ephemeral: true });

    const infractions = await Infraction.find({
      guildId: interaction.guildId,
      userId: user.id
    })
      .sort({ createdAt: -1 })
      .limit(10);

    if (!infractions.length) {
      await interaction.editReply({
        content: "Nenhuma infracao encontrada para este usuario."
      });
      return;
    }

    const lines = infractions.map((item, index) => {
      const id = String(item._id).slice(-6);
      const reason = item.reason ? item.reason : "Sem motivo";
      const duration = formatDuration(item.durationMs);
      const when = item.createdAt
        ? item.createdAt.toLocaleString("pt-BR")
        : "";
      const mod = item.moderatorId ? `<@${item.moderatorId}>` : "Desconhecido";
      const suffix = duration ? ` (${duration})` : "";
      return `**${index + 1}.** [${id}] ${item.type}${suffix} - ${reason} - ${when} - ${mod}`;
    });

    await interaction.editReply({
      content: lines.join("\n").slice(0, 2000)
    });
  }
};
