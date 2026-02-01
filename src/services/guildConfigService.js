import GuildConfig from "../models/GuildConfig.js";

const CONFIG_CACHE_TTL_MS = 30_000;

const cache = global._guildConfigLeanCache ?? new Map();
const inflight = global._guildConfigLeanInflight ?? new Map();

global._guildConfigLeanCache = cache;
global._guildConfigLeanInflight = inflight;

export function invalidateGuildConfigCache(guildId) {
  if (!guildId) return;
  cache.delete(String(guildId));
  inflight.delete(String(guildId));
}

export async function getGuildConfigLean(guildId) {
  const key = String(guildId ?? "");
  if (!key) return null;

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const running = inflight.get(key);
  if (running) return running;

  const promise = GuildConfig.findOne({ guildId: key })
    .lean()
    .then((doc) => {
      const value = doc ?? null;
      cache.set(key, {
        value,
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MS
      });
      inflight.delete(key);
      return value;
    })
    .catch((error) => {
      inflight.delete(key);
      throw error;
    });

  inflight.set(key, promise);
  return promise;
}

export async function getOrCreateGuildConfigDoc(guildId) {
  const key = String(guildId ?? "");
  if (!key) throw new Error("guildId is required");

  let doc = await GuildConfig.findOne({ guildId: key });
  if (!doc) {
    doc = new GuildConfig({ guildId: key });
  }
  return doc;
}

export async function saveGuildConfigDoc(doc) {
  if (!doc) throw new Error("doc is required");
  await doc.save();
  invalidateGuildConfigCache(doc.guildId);
  return doc;
}

