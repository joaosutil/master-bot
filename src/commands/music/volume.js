import { SlashCommandBuilder } from "discord.js";
import { getVolume, setVolume } from "../../music/musicService.js";
import { requireGuild } from "../../music/musicUtils.js";

const data = new SlashCommandBuilder()
  .setName("volume")
  .setDescription("Ajusta o volume da música (padrão mais baixo)")
  .addIntegerOption((opt) =>
    opt
      .setName("valor")
      .setDescription("0 a 200 (em %)")
      .setMinValue(0)
      .setMaxValue(200)
      .setRequired(false)
  );

export default {
  data,
  async execute(interaction) {
    try {
      const guildId = requireGuild(interaction);
      const value = interaction.options.getInteger("valor", false);

      if (value == null) {
        const cur = Math.round(getVolume(guildId) * 100);
        return await interaction.reply({ content: `Volume atual: **${cur}%**`, ephemeral: true });
      }

      const v = setVolume(guildId, value / 100);
      await interaction.reply({
        content: `Volume ajustado para **${Math.round(v * 100)}%**.`,
        ephemeral: true
      });
    } catch (error) {
      await interaction.reply({
        content: error?.message ?? "Erro ao ajustar volume.",
        ephemeral: true
      });
    }
  }
};

