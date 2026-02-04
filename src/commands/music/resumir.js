import { SlashCommandBuilder } from "discord.js";
import { resume } from "../../music/musicService.js";
import { requireGuild } from "../../music/musicUtils.js";

const data = new SlashCommandBuilder()
  .setName("resumir")
  .setDescription("Continua a música pausada");

export default {
  data,
  async execute(interaction) {
    try {
      const guildId = requireGuild(interaction);
      const ok = resume(guildId);
      await interaction.reply({ content: ok ? "Retomado." : "Nada para retomar.", ephemeral: true });
    } catch (error) {
      await interaction.reply({
        content: error?.message ?? "Erro ao resumir.",
        ephemeral: true
      });
    }
  }
};

