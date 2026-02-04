import { SlashCommandBuilder } from "discord.js";
import { skip } from "../../music/musicService.js";
import { requireGuild } from "../../music/musicUtils.js";

const data = new SlashCommandBuilder()
  .setName("pular")
  .setDescription("Pula a música atual");

export default {
  data,
  async execute(interaction) {
    try {
      const guildId = requireGuild(interaction);
      skip(guildId);
      await interaction.reply({ content: "Pulou.", ephemeral: true });
    } catch (error) {
      await interaction.reply({
        content: error?.message ?? "Erro ao pular.",
        ephemeral: true
      });
    }
  }
};

