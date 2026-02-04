import { SlashCommandBuilder } from "discord.js";
import { stop } from "../../music/musicService.js";
import { requireGuild } from "../../music/musicUtils.js";

const data = new SlashCommandBuilder()
  .setName("parar")
  .setDescription("Para tudo e sai da call");

export default {
  data,
  async execute(interaction) {
    try {
      const guildId = requireGuild(interaction);
      stop(guildId);
      await interaction.reply({ content: "Parado e desconectado.", ephemeral: true });
    } catch (error) {
      await interaction.reply({
        content: error?.message ?? "Erro ao parar.",
        ephemeral: true
      });
    }
  }
};

