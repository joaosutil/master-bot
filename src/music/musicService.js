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

const guildMusic = new Map();
let playDlInit = null;

function isSpotifyUrl(url) {
  const s = String(url ?? "").trim();
  return /^https?:\/\/open\.spotify\.com\/(track|album|playlist)\//i.test(s);
}

async function getSpotifyOEmbedTitle(url) {
  const u = String(url ?? "").trim();
  const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(u)}`, {
    headers: {
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
    current: null,
    currentResource: null,
    volume: 0.35,
    disconnectTimer: null
  };

  player.on(AudioPlayerStatus.Idle, () => {
    state.current = null;
    state.currentResource = null;
    void playNext(state).catch((error) => {
      console.warn("[music] playNext error:", error);
      scheduleDisconnect(state);
    });
  });

  player.on(AudioPlayerStatus.Playing, () => {
    clearDisconnectTimer(state);
  });

  player.on(AudioPlayerStatus.Paused, () => {
    scheduleDisconnect(state);
  });

  player.on(AudioPlayerStatus.AutoPaused, () => {
    scheduleDisconnect(state);
  });

  player.on("error", (error) => {
    console.warn("[music] player error:", error);
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

  // Spotify links: use metadata as search query (audio still comes from other source).
  if (trimmed.startsWith("http") && isSpotifyUrl(trimmed)) {
    try {
      trimmed = await getSpotifyOEmbedTitle(trimmed);
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

export async function enqueueTrack({ guildId, voiceChannel, query, requestedById }) {
  const state = ensureState(guildId);
  await ensureConnected(state, voiceChannel);

  const track = await resolveTrack(query);
  const fullTrack = {
    ...track,
    requestedById,
    requestedAt: Date.now()
  };

  state.queue.push(fullTrack);
  if (state.queue.length > 100) state.queue.length = 100;

  if (!state.current && state.player.state.status === AudioPlayerStatus.Idle) {
    await playNext(state, { throwOnFailure: true });
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

export function skip(guildId) {
  const state = ensureState(guildId);
  state.player.stop(true);
  return true;
}

export function stop(guildId) {
  const state = ensureState(guildId);
  state.queue = [];
  state.current = null;
  state.currentResource = null;
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
