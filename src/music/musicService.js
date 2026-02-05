import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} from "@discordjs/voice";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";

const guildMusic = new Map();
let playDlInit = null;

function makeTrackKey(track) {
  if (!track) return null;
  return `${track.url}|${track.requestedAt ?? ""}`;
}

function isSpotifyInput(input) {
  const s = String(input ?? "").trim();
  if (!s) return false;
  if (/^spotify:(track|album|playlist):/i.test(s)) return true;
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    if (u.hostname === "open.spotify.com") return true;
    if (u.hostname === "spoti.fi") return true;
    if (u.hostname === "spotify.link") return true;
    return false;
  } catch {
    return false;
  }
}

function toSpotifyOpenUrl(input) {
  const s = String(input ?? "").trim();
  const m = s.match(/^spotify:(track|album|playlist):([A-Za-z0-9]+)$/i);
  if (!m) return s;
  const type = m[1].toLowerCase();
  const id = m[2];
  return `https://open.spotify.com/${type}/${id}`;
}

async function resolveFinalUrl(url) {
  if (typeof fetch !== "function") return String(url ?? "").trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(String(url ?? "").trim(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0"
      }
    });
    try {
      res.body?.cancel?.();
    } catch {}
    return res.url || String(url ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}

async function normalizeKnownShortLinks(url) {
  const s = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(s)) return s;
  try {
    const u = new URL(s);
    const shortHosts = new Set(["spoti.fi", "spotify.link", "on.soundcloud.com", "soundcloud.app.goo.gl"]);
    if (!shortHosts.has(u.hostname)) return s;
    return await resolveFinalUrl(s);
  } catch {
    return s;
  }
}

async function getSpotifyOEmbedTitle(url) {
  const u = String(url ?? "").trim();
  const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(u)}`, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0"
    }
  });
  if (!res.ok) throw new Error(`Spotify oEmbed falhou (${res.status})`);
  const json = await res.json();
  const title = String(json?.title ?? "").trim();
  if (!title) throw new Error("Spotify oEmbed sem título.");
  return title;
}

function normalizeInputType(type) {
  if (typeof type === "number") return type;
  const key = String(type ?? "").toLowerCase();
  if (key.includes("webm")) return StreamType.WebmOpus;
  if (key.includes("ogg")) return StreamType.OggOpus;
  if (key.includes("opus")) return StreamType.Opus;
  if (key.includes("raw")) return StreamType.Raw;
  return StreamType.Arbitrary;
}

function formatDuration(totalSeconds) {
  const seconds = Number(totalSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return "Ao vivo";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function getPlayDl() {
  const mod = await import("play-dl");
  return mod.default ?? mod;
}

async function initPlayDlOnce(play) {
  if (playDlInit) return playDlInit;

  playDlInit = (async () => {
    const token = {};

    const cookie = String(process.env.YOUTUBE_COOKIE ?? "").trim();
    if (cookie) token.youtube = { cookie };

    const userAgent = String(process.env.YOUTUBE_USERAGENT ?? "").trim();
    if (userAgent) token.useragent = [userAgent];

    const scId = String(process.env.SOUNDCLOUD_CLIENT_ID ?? "").trim();
    if (scId) {
      token.soundcloud = { client_id: scId };
    } else {
      try {
        const freeId = await play.getFreeClientID();
        if (freeId) token.soundcloud = { client_id: freeId };
      } catch (error) {
        console.warn("[music] failed to get SoundCloud client_id:", error?.message ?? error);
      }
    }

    if (Object.keys(token).length > 0) {
      await play.setToken(token);
    }
  })();

  return playDlInit;
}

async function getPlayDlReady() {
  const play = await getPlayDl();
  await initPlayDlOnce(play);
  return play;
}

function ensureState(guildId) {
  const existing = guildMusic.get(guildId);
  if (existing) return existing;

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
  });

  const state = {
    guildId,
    connection: null,
    player,
    queue: [],
    history: [],
    current: null,
    currentResource: null,
    volume: 0.35,
    announceChannelId: null,
    client: null,
    lastAnnouncedKey: null,
    suppressHistoryPushOnce: false,
    disconnectTimer: null
  };

  player.on(AudioPlayerStatus.Idle, () => {
    if (state.current && !state.suppressHistoryPushOnce) {
      state.history.push(state.current);
      if (state.history.length > 50) state.history.shift();
    }
    state.suppressHistoryPushOnce = false;
    state.current = null;
    state.currentResource = null;
    void playNext(state).catch((error) => {
      console.warn("[music] playNext error:", error);
      scheduleDisconnect(state);
    });
  });

  player.on(AudioPlayerStatus.Playing, () => {
    clearDisconnectTimer(state);
    void announceNowPlayingIfNew(state).catch((error) => {
      console.warn("[music] announce error:", error);
    });
  });

  player.on(AudioPlayerStatus.Paused, () => {
    scheduleDisconnect(state);
  });

  player.on(AudioPlayerStatus.AutoPaused, () => {
    scheduleDisconnect(state);
  });

  player.on("error", (error) => {
    console.warn("[music] player error:", error);
    if (state.current && !state.suppressHistoryPushOnce) {
      state.history.push(state.current);
      if (state.history.length > 50) state.history.shift();
    }
    state.suppressHistoryPushOnce = false;
    state.current = null;
    state.currentResource = null;
    void playNext(state).catch((error2) => {
      console.warn("[music] playNext error:", error2);
      scheduleDisconnect(state);
    });
  });

  guildMusic.set(guildId, state);
  return state;
}

function clearDisconnectTimer(state) {
  if (!state.disconnectTimer) return;
  clearTimeout(state.disconnectTimer);
  state.disconnectTimer = null;
}

function scheduleDisconnect(state) {
  clearDisconnectTimer(state);
  state.disconnectTimer = setTimeout(() => {
    try {
      state.player.stop(true);
    } catch {}
    try {
      state.connection?.destroy();
    } catch {}
    state.connection = null;
    state.current = null;
    state.queue = [];
  }, 120_000);
}

export function setAnnouncementTarget(guildId, { channelId, client } = {}) {
  const state = ensureState(guildId);
  if (channelId) state.announceChannelId = channelId;
  if (client) state.client = client;
}

export function buildNowPlayingPayload(guildId, { titlePrefix } = {}) {
  const state = ensureState(guildId);
  const now = state.current;

  if (!now) {
    return { content: "Nada tocando agora.", embeds: [], components: [] };
  }

  const isPaused =
    state.player.state.status === AudioPlayerStatus.Paused ||
    state.player.state.status === AudioPlayerStatus.AutoPaused;

  const volPct = Math.round((state.volume ?? 0.35) * 100);

  const embed = new EmbedBuilder()
    .setColor(isPaused ? 0xf59e0b : 0x22c55e)
    .setTitle(titlePrefix ?? (isPaused ? "Pausado" : "Tocando agora"))
    .setDescription(`[${now.title}](${now.url})`)
    .addFields(
      { name: "Duração", value: now.durationLabel ?? "—", inline: true },
      { name: "Volume", value: `${volPct}%`, inline: true },
      { name: "Pedido por", value: now.requestedById ? `<@${now.requestedById}>` : "—", inline: true }
    )
    .setTimestamp(new Date());

  if (now.thumbnailUrl) embed.setThumbnail(now.thumbnailUrl);

  const prevDisabled = state.history.length === 0;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music:prev")
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Voltar")
      .setDisabled(prevDisabled),
    new ButtonBuilder().setCustomId("music:skip").setStyle(ButtonStyle.Primary).setLabel("Pular"),
    new ButtonBuilder()
      .setCustomId("music:toggle_pause")
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setLabel(isPaused ? "Resumir" : "Pausar"),
    new ButtonBuilder().setCustomId("music:vol_down").setStyle(ButtonStyle.Secondary).setLabel("Vol -"),
    new ButtonBuilder().setCustomId("music:vol_up").setStyle(ButtonStyle.Secondary).setLabel("Vol +")
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("music:stop").setStyle(ButtonStyle.Danger).setLabel("Parar")
  );

  return { embeds: [embed], components: [row, row2] };
}

async function announceNowPlayingIfNew(state) {
  const channelId = state.announceChannelId;
  const client = state.client;
  const key = makeTrackKey(state.current);
  if (!channelId || !client || !key) return;
  if (state.lastAnnouncedKey === key) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || typeof channel.send !== "function") return;

  const payload = buildNowPlayingPayload(state.guildId);
  await channel.send(payload).catch(() => {});
  state.lastAnnouncedKey = key;
}

async function ensureConnected(state, voiceChannel) {
  const guildId = voiceChannel.guild.id;

  if (state.connection) {
    const connectedChannelId = state.connection.joinConfig?.channelId ?? null;
    if (connectedChannelId && connectedChannelId !== voiceChannel.id) {
      throw new Error("Já estou tocando em outra call deste servidor.");
    }
    return;
  }

  const existing = getVoiceConnection(guildId);
  if (existing) {
    const connectedChannelId = existing.joinConfig?.channelId ?? null;
    if (connectedChannelId && connectedChannelId !== voiceChannel.id) {
      throw new Error("Já estou tocando em outra call deste servidor.");
    }
    state.connection = existing;
  } else {
    state.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true
    });
  }

  state.connection.subscribe(state.player);

  state.connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(state.connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(state.connection, VoiceConnectionStatus.Connecting, 5_000)
      ]);
    } catch {
      try {
        state.connection?.destroy();
      } catch {}
      state.connection = null;
      scheduleDisconnect(state);
    }
  });

  await entersState(state.connection, VoiceConnectionStatus.Ready, 20_000);
}

async function resolveTrack(query) {
  const play = await getPlayDlReady();

  if (typeof query !== "string" || !query.trim()) {
    throw new Error("Informe um nome ou link da música.");
  }

  const raw = query.trim();
  let trimmed = raw;

  if (trimmed.startsWith("http")) {
    trimmed = await normalizeKnownShortLinks(trimmed);
  }

  // Spotify links: use metadata as search query (audio still comes from other source).
  if (isSpotifyInput(trimmed)) {
    try {
      const openUrl = toSpotifyOpenUrl(trimmed);
      const finalUrl = await resolveFinalUrl(openUrl);
      trimmed = await getSpotifyOEmbedTitle(finalUrl);
    } catch (error) {
      console.warn("[music] spotify oembed error:", error);
      throw new Error("Não consegui ler esse link do Spotify. Tente enviar o nome da música.");
    }
  }

  let video = null;
  const allowYouTube = String(process.env.MUSIC_ALLOW_YOUTUBE ?? "0").trim() === "1";

  if (trimmed.startsWith("http")) {
    const ytType = play.yt_validate?.(trimmed);
    if ((ytType === "video" || ytType === "playlist") && !allowYouTube) {
      throw new Error(
        "Link do YouTube não está habilitado. Envie o **nome da música** ou um link do **SoundCloud/Spotify**. " +
          "Se quiser permitir YouTube, defina `MUSIC_ALLOW_YOUTUBE=1` (pode ser bloqueado pelo YouTube)."
      );
    }

    // Prefer SoundCloud links when available.
    try {
      const scType = await play.so_validate?.(trimmed);
      if (scType === "track") {
        const sc = await play.soundcloud(trimmed);
        video = sc ?? null;
      }
    } catch {}

    // Deezer links: use metadata as search query (audio still comes from other source).
    if (!video) {
      try {
        const dzType = await play.dz_validate?.(trimmed);
        if (dzType === "track") {
          const dz = await play.deezer(trimmed);
          const dzTitle = String(dz?.title ?? "").trim();
          const dzArtist = String(dz?.artist?.name ?? "").trim();
          if (dzTitle) trimmed = dzArtist ? `${dzArtist} - ${dzTitle}` : dzTitle;
        }
      } catch {}
    }

    if (!video && allowYouTube && play.yt_validate?.(trimmed) === "video") {
      const info = await play.video_basic_info(trimmed);
      video = info?.video_details ?? null;
    }
  }

  if (!video) {
    // Search: default SoundCloud to avoid YouTube blocks.
    try {
      const results = await play.search(trimmed, {
        limit: 1,
        source: { soundcloud: "tracks" }
      });
      video = results?.[0] ?? null;
    } catch (error) {
      const msg = String(error?.message ?? "");
      if (msg.toLowerCase().includes("client_id")) {
        throw new Error(
          "Falha ao usar SoundCloud (sem client_id). Defina `SOUNDCLOUD_CLIENT_ID` no `.env` e reinicie o bot."
        );
      }
      throw error;
    }
  }

  if (!video && allowYouTube) {
    const results = await play.search(trimmed, { limit: 1 });
    video = results?.[0] ?? null;
  }

  if (!video) {
    throw new Error(
      `Não encontrei nada no SoundCloud com essa busca. Tente "artista - título" (busca: ${raw.slice(0, 80)})`
    );
  }

  if (!video?.url || !video?.title) {
    const title = String(video?.title ?? video?.name ?? "").trim();
    const url = String(video?.permalink ?? video?.url ?? "").trim();
    if (!title || !url) throw new Error("Não encontrei nada com essa busca.");
  }

  const title = String(video.title ?? video.name ?? "").trim();
  const url = String(video.permalink ?? video.url ?? "").trim();

  const durationSec = Number(video.durationInSec);
  const thumbs = Array.isArray(video.thumbnails) ? video.thumbnails : [];
  const thumb =
    thumbs.at(-1)?.url ??
    thumbs[0]?.url ??
    (typeof video.thumbnail === "string" ? video.thumbnail : null) ??
    video.thumbnail?.url ??
    (Array.isArray(video.thumbnail) ? video.thumbnail[0]?.url : null) ??
    null;

  return {
    title,
    url,
    durationSec: Number.isFinite(durationSec) ? durationSec : null,
    durationLabel: formatDuration(durationSec),
    thumbnailUrl: thumb
  };
}

function isYouTubeBlockedError(error) {
  const msg = String(error?.message ?? "").toLowerCase();
  return (
    msg.includes("sign in to confirm") ||
    msg.includes("confirm you’re not a bot") ||
    msg.includes("confirm you're not a bot")
  );
}

async function playNext(state, { throwOnFailure = false } = {}) {
  clearDisconnectTimer(state);

  if (state.player.state.status !== AudioPlayerStatus.Idle && state.current) return;

  const next = state.queue.shift() ?? null;
  if (!next) {
    scheduleDisconnect(state);
    return;
  }

  try {
    const play = await getPlayDlReady();
    const stream = await play.stream(next.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, {
      inputType: normalizeInputType(stream.type),
      inlineVolume: true,
      metadata: next
    });

    state.current = next;
    state.currentResource = resource;
    try {
      resource.volume?.setVolume?.(state.volume);
    } catch {}
    state.player.play(resource);
  } catch (error) {
    console.warn("[music] stream error:", error);
    state.current = null;
    state.currentResource = null;
    if (throwOnFailure) {
      if (isYouTubeBlockedError(error)) {
        throw new Error(
          "O YouTube bloqueou o player (\"Sign in to confirm you’re not a bot\"). " +
            "Recomendado: usar Lavalink. Alternativa: definir `YOUTUBE_COOKIE` no `.env` (cookie de uma conta) e reiniciar o bot."
        );
      }
      throw new Error("Falha ao obter o áudio desta música. Tente outro link/busca.");
    }

    await playNext(state, { throwOnFailure: false });
  }
}

export function getNowPlaying(guildId) {
  const state = guildMusic.get(guildId);
  return state?.current ?? null;
}

export function getQueue(guildId) {
  const state = guildMusic.get(guildId);
  return state ? [...state.queue] : [];
}

export function getVolume(guildId) {
  const state = ensureState(guildId);
  return state.volume;
}

export function setVolume(guildId, volume) {
  const state = ensureState(guildId);
  const v = Number(volume);
  const clamped = Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : state.volume;
  state.volume = clamped;
  try {
    state.currentResource?.volume?.setVolume?.(clamped);
  } catch {}
  return clamped;
}

export function adjustVolume(guildId, delta) {
  const state = ensureState(guildId);
  return setVolume(guildId, (state.volume ?? 0.35) + Number(delta));
}

export async function enqueueTrack({
  guildId,
  voiceChannel,
  textChannel,
  query,
  requestedById,
  suppressAutoAnnounce = false
}) {
  const state = ensureState(guildId);
  await ensureConnected(state, voiceChannel);

  if (textChannel?.id) state.announceChannelId = textChannel.id;
  if (textChannel?.client) state.client = textChannel.client;

  const track = await resolveTrack(query);
  const fullTrack = {
    ...track,
    requestedById,
    requestedAt: Date.now()
  };

  const willStartNow = !state.current && state.player.state.status === AudioPlayerStatus.Idle;

  state.queue.push(fullTrack);
  if (state.queue.length > 100) state.queue.length = 100;

  if (!state.current && state.player.state.status === AudioPlayerStatus.Idle) {
    await playNext(state, { throwOnFailure: true });
    if (suppressAutoAnnounce && willStartNow) {
      state.lastAnnouncedKey = makeTrackKey(state.current);
    }
  }

  return fullTrack;
}

export function pause(guildId) {
  const state = ensureState(guildId);
  const ok = state.player.pause();
  if (ok) scheduleDisconnect(state);
  return ok;
}

export function resume(guildId) {
  const state = ensureState(guildId);
  const ok = state.player.unpause();
  if (ok) clearDisconnectTimer(state);
  return ok;
}

export function togglePause(guildId) {
  const state = ensureState(guildId);
  const status = state.player.state.status;
  if (status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused) {
    resume(guildId);
    return { paused: false };
  }
  pause(guildId);
  return { paused: true };
}

export function skip(guildId) {
  const state = ensureState(guildId);
  state.player.stop(true);
  return true;
}

export function previous(guildId) {
  const state = ensureState(guildId);
  const prev = state.history.pop();
  if (!prev) return false;

  if (state.current) state.queue.unshift(state.current);
  state.queue.unshift(prev);
  state.suppressHistoryPushOnce = true;
  state.player.stop(true);
  return true;
}

export function stop(guildId) {
  const state = ensureState(guildId);
  state.queue = [];
  state.history = [];
  state.current = null;
  state.currentResource = null;
  state.lastAnnouncedKey = null;
  try {
    state.player.stop(true);
  } catch {}
  try {
    state.connection?.destroy();
  } catch {}
  state.connection = null;
  clearDisconnectTimer(state);
  return true;
}
