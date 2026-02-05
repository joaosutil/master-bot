import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { buildNowPlayingPayload, enqueueTrack, getNowPlaying } from "../../music/musicService.js";
import { getMemberVoiceChannel, requireGuild } from "../../music/musicUtils.js";

const data = new SlashCommandBuilder()
  .setName("tocar")
  .setDescription("Toca uma música na call")
  .addStringOption((opt) =>
    opt
      .setName("musica")
      .setDescription("Nome ou link (SoundCloud/Spotify/Deezer)")
      .setRequired(true)
  );

export default {
  data,
  async execute(interaction) {
    try {
      const guildId = requireGuild(interaction);
      const voiceChannel = getMemberVoiceChannel(interaction);
      const query = interaction.options.getString("musica", true);

      await interaction.deferReply();

      const track = await enqueueTrack({
        guildId,
        voiceChannel,
        query,
        requestedById: interaction.user.id,
        textChannel: interaction.channel,
        suppressAutoAnnounce: true
      });

      const now = getNowPlaying(guildId);
      const isNow =
        now?.url === track.url &&
        now?.requestedById === track.requestedById &&
        now?.requestedAt === track.requestedAt;

      if (isNow) {
        const payload = buildNowPlayingPayload(guildId);
        await interaction.editReply(payload);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("Adicionado à fila")
        .setDescription(`[${track.title}](${track.url})`)
        .addFields(
          { name: "Duração", value: track.durationLabel ?? "—", inline: true },
          { name: "Pedido por", value: `<@${track.requestedById}>`, inline: true }
        )
        .setFooter({ text: "Dica: use /fila ou /tocando" });

      if (track.thumbnailUrl) embed.setThumbnail(track.thumbnailUrl);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const message = error?.message ?? "Erro ao tocar música.";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: message, embeds: [] });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  }
};
