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
    disconnectTimer: null
  };

  player.on(AudioPlayerStatus.Idle, () => {
    state.current = null;
    void playNext(state).catch((error) => {
      console.warn("[music] playNext error:", error);
      scheduleDisconnect(state);
    });
  });

  player.on("error", (error) => {
    console.warn("[music] player error:", error);
    state.current = null;
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
  const play = await getPlayDl();

  if (typeof query !== "string" || !query.trim()) {
    throw new Error("Informe um nome ou link da música.");
  }

  const trimmed = query.trim();

  let video = null;
  if (trimmed.startsWith("http") && play.yt_validate?.(trimmed) === "video") {
    const info = await play.video_basic_info(trimmed);
    video = info?.video_details ?? null;
  } else if (play.yt_validate?.(trimmed) === "video") {
    const info = await play.video_basic_info(trimmed);
    video = info?.video_details ?? null;
  } else {
    const results = await play.search(trimmed, { limit: 1 });
    video = results?.[0] ?? null;
  }

  if (!video?.url || !video?.title) {
    throw new Error("Não encontrei nada com essa busca.");
  }

  const durationSec = Number(video.durationInSec);
  const thumbs = Array.isArray(video.thumbnails) ? video.thumbnails : [];
  const thumb =
    thumbs.at(-1)?.url ??
    thumbs[0]?.url ??
    video.thumbnail?.url ??
    (Array.isArray(video.thumbnail) ? video.thumbnail[0]?.url : null) ??
    null;

  return {
    title: video.title,
    url: video.url,
    durationSec: Number.isFinite(durationSec) ? durationSec : null,
    durationLabel: formatDuration(durationSec),
    thumbnailUrl: thumb
  };
}

async function playNext(state) {
  clearDisconnectTimer(state);

  if (state.player.state.status !== AudioPlayerStatus.Idle && state.current) return;

  const next = state.queue.shift() ?? null;
  if (!next) {
    scheduleDisconnect(state);
    return;
  }

  try {
    const play = await getPlayDl();
    const stream = await play.stream(next.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, {
      inputType: normalizeInputType(stream.type),
      metadata: next
    });

    state.current = next;
    state.player.play(resource);
  } catch (error) {
    console.warn("[music] stream error:", error);
    state.current = null;
    await playNext(state);
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
    await playNext(state);
  }

  return fullTrack;
}

export function pause(guildId) {
  const state = ensureState(guildId);
  return state.player.pause();
}

export function resume(guildId) {
  const state = ensureState(guildId);
  return state.player.unpause();
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
