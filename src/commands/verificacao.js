import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import { disableVerification, ensureVerifyPanel } from "../services/verificationService.js";

const data = new SlashCommandBuilder()
  .setName("verificacao")
  .setDescription("Configura e publica o painel de verificação")
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName("painel")
      .setDescription("Cria a mensagem com botão de verificação")
      .addChannelOption((opt) =>
        opt
          .setName("canal")
          .setDescription("Canal onde o painel ficará")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addRoleOption((opt) =>
        opt
          .setName("cargo")
          .setDescription("Cargo para marcar como verificado")
          .setRequired(true)
      )
      .addRoleOption((opt) =>
        opt
          .setName("remover_cargo")
          .setDescription("Cargo para remover ao verificar (opcional)")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("desativar")
      .setDescription("Desativa a verificação (não apaga mensagens antigas)")
  );

function hasManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

export default {
  data,
  async execute(interaction) {
    if (!hasManageGuild(interaction)) {
      await interaction.reply({
        content: "Você precisa de Manage Guild para usar isso.",
        ephemeral: true
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "painel") {
      const channel = interaction.options.getChannel("canal", true);
      const role = interaction.options.getRole("cargo", true);
      const removeRole = interaction.options.getRole("remover_cargo");
      await ensureVerifyPanel(interaction, { channel, role, removeRole });
      return;
    }

    if (sub === "desativar") {
      await disableVerification(interaction);
    }
  }
};
