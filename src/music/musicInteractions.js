import { getVoiceConnection } from "@discordjs/voice";
import {
  adjustVolume,
  buildNowPlayingPayload,
  previous,
  setAnnouncementTarget,
  skip,
  stop,
  togglePause
} from "./musicService.js";

function getGuildId(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) throw new Error("Este botão só funciona em servidor.");
  return guildId;
}

function assertSameVoiceChannel(interaction, guildId) {
  const conn = getVoiceConnection(guildId);
  const botChannelId = conn?.joinConfig?.channelId ?? null;
  if (!botChannelId) return;

  const memberChannelId = interaction.member?.voice?.channelId ?? null;
  if (!memberChannelId || memberChannelId !== botChannelId) {
    throw new Error("Entre na mesma call do bot para controlar a música.");
  }
}

export async function handleMusicButton(interaction) {
  const guildId = getGuildId(interaction);
  assertSameVoiceChannel(interaction, guildId);

  setAnnouncementTarget(guildId, { channelId: interaction.channelId, client: interaction.client });

  const id = String(interaction.customId);
  if (!id.startsWith("music:")) return false;

  const action = id.slice("music:".length);

  if (action === "vol_up") {
    adjustVolume(guildId, 0.1);
    const payload = buildNowPlayingPayload(guildId, { titlePrefix: "Volume ajustado" });
    await interaction.update(payload);
    return true;
  }

  if (action === "vol_down") {
    adjustVolume(guildId, -0.1);
    const payload = buildNowPlayingPayload(guildId, { titlePrefix: "Volume ajustado" });
    await interaction.update(payload);
    return true;
  }

  if (action === "toggle_pause") {
    togglePause(guildId);
    const payload = buildNowPlayingPayload(guildId);
    await interaction.update(payload);
    return true;
  }

  if (action === "skip") {
    await interaction.deferUpdate();
    skip(guildId);
    return true;
  }

  if (action === "prev") {
    await interaction.deferUpdate();
    const ok = previous(guildId);
    if (!ok) {
      await interaction.followUp({ content: "Não tem música anterior.", ephemeral: true }).catch(() => {});
    }
    return true;
  }

  if (action === "stop") {
    stop(guildId);
    await interaction.update({
      content: "Parado e desconectado.",
      embeds: [],
      components: []
    });
    return true;
  }

  return false;
}

