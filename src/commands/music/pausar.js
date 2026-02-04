import { SlashCommandBuilder } from "discord.js";
import { pause } from "../../music/musicService.js";
import { requireGuild } from "../../music/musicUtils.js";

const data = new SlashCommandBuilder()
  .setName("pausar")
  .setDescription("Pausa a música atual");

export default {
  data,
  async execute(interaction) {
    try {
      const guildId = requireGuild(interaction);
      const ok = pause(guildId);
      await interaction.reply({ content: ok ? "Pausado." : "Nada para pausar.", ephemeral: true });
    } catch (error) {
      await interaction.reply({
        content: error?.message ?? "Erro ao pausar.",
        ephemeral: true
      });
    }
  }
};

