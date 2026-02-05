import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { buildNowPlayingPayload, enqueueFromQuery, getNowPlaying } from "../../music/musicService.js";
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

      let lastProgress = 0;
      const result = await enqueueFromQuery({
        guildId,
        voiceChannel,
        query,
        requestedById: interaction.user.id,
        textChannel: interaction.channel,
        suppressAutoAnnounce: true,
        onProgress: ({ processed, total, playlistName }) => {
          const now = Date.now();
          if (now - lastProgress < 2500) return;
          lastProgress = now;
          const name = playlistName ? ` "${playlistName}"` : "";
          void interaction.editReply({ content: `Adicionando playlist${name}... ${processed}/${total}` }).catch(() => {});
        }
      });

      if (result?.kind === "spotify_playlist") {
        const now = getNowPlaying(guildId);

        const embed = new EmbedBuilder()
          .setColor(0x22c55e)
          .setTitle("Playlist adicionada à fila")
          .setDescription(`[${result.playlistName}](${result.playlistUrl})`)
          .addFields(
            { name: "Adicionadas", value: `${result.added}/${result.considered}`, inline: true },
            { name: "Ignoradas", value: String(result.failed), inline: true },
            {
              name: "Total",
              value: `${result.totalTracks}${result.truncated ? ` (limitado a ${result.considered} pela fila)` : ""}`,
              inline: true
            }
          )
          .setFooter({ text: "Dica: use /fila ou /tocando" });

        if (result.startedNow && now?.title && now?.url) {
          embed.addFields({ name: "Tocando agora", value: `[${now.title}](${now.url})` });
          if (now.thumbnailUrl) embed.setThumbnail(now.thumbnailUrl);
        }

        await interaction.editReply({ content: "", embeds: [embed], components: [] });
        return;
      }

      const track = result?.track;
      const now = getNowPlaying(guildId);
      const isNow =
        now?.url === track.url &&
        now?.requestedById === track.requestedById &&
        now?.requestedAt === track.requestedAt;

      if (isNow) {
        const payload = buildNowPlayingPayload(guildId);
        await interaction.editReply({ ...payload, content: "" });
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

      await interaction.editReply({ content: "", embeds: [embed] });
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
