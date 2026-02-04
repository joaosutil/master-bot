import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { getNowPlaying, getQueue } from "../../music/musicService.js";
import { requireGuild } from "../../music/musicUtils.js";

const data = new SlashCommandBuilder()
  .setName("fila")
  .setDescription("Mostra a fila de músicas");

export default {
  data,
  async execute(interaction) {
    try {
      const guildId = requireGuild(interaction);
      const now = getNowPlaying(guildId);
      const queue = getQueue(guildId);

      if (!now && queue.length === 0) {
        return await interaction.reply({ content: "Fila vazia.", ephemeral: true });
      }

      const lines = queue.slice(0, 10).map((t, i) => `${i + 1}. [${t.title}](${t.url})`);
      const embed = new EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("Fila")
        .setDescription(
          [
            now ? `**Agora:** [${now.title}](${now.url})` : "**Agora:** —",
            "",
            lines.length ? lines.join("\n") : "_Sem próximas músicas_"
          ].join("\n")
        );

      await interaction.reply({ embeds: [embed], ephemeral: false });
    } catch (error) {
      await interaction.reply({
        content: error?.message ?? "Erro ao mostrar a fila.",
        ephemeral: true
      });
    }
  }
};

