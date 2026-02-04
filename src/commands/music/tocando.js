import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { getNowPlaying } from "../../music/musicService.js";
import { requireGuild } from "../../music/musicUtils.js";

const data = new SlashCommandBuilder()
  .setName("tocando")
  .setDescription("Mostra a música atual");

export default {
  data,
  async execute(interaction) {
    try {
      const guildId = requireGuild(interaction);
      const now = getNowPlaying(guildId);
      if (!now) {
        return await interaction.reply({ content: "Nada tocando agora.", ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor(0xa855f7)
        .setTitle("Tocando agora")
        .setDescription(`[${now.title}](${now.url})`)
        .addFields(
          { name: "Duração", value: now.durationLabel ?? "—", inline: true },
          { name: "Pedido por", value: `<@${now.requestedById}>`, inline: true }
        );

      if (now.thumbnailUrl) embed.setThumbnail(now.thumbnailUrl);

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await interaction.reply({
        content: error?.message ?? "Erro ao mostrar o que está tocando.",
        ephemeral: true
      });
    }
  }
};

