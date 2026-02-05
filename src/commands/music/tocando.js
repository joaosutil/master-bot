import { SlashCommandBuilder } from "discord.js";
import { buildNowPlayingPayload, getNowPlaying, setAnnouncementTarget } from "../../music/musicService.js";
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

      setAnnouncementTarget(guildId, { channelId: interaction.channelId, client: interaction.client });
      const payload = buildNowPlayingPayload(guildId);
      await interaction.reply(payload);
    } catch (error) {
      await interaction.reply({
        content: error?.message ?? "Erro ao mostrar o que está tocando.",
        ephemeral: true
      });
    }
  }
};
