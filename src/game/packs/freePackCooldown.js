import mongoose from "mongoose";

const COOLDOWN_MS = 10 * 60 * 1000;
const GLOBAL_SCOPE_GUILD_ID = "global";

const FreePackCooldownSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    lastAt: { type: Date, default: null },
    legacyMerged: { type: Boolean, default: false }
  },
  { timestamps: true }
);

FreePackCooldownSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const FreePackCooldown =
  mongoose.models.FreePackCooldown ??
  mongoose.model("FreePackCooldown", FreePackCooldownSchema);

function isMongoConnected() {
  return mongoose.connection?.readyState === 1;
}

function withSession(query, session) {
  return session ? query.session(session) : query;
}

async function ensureGlobalCooldownMerged(userId, { session } = {}) {
  const global = await withSession(
    FreePackCooldown.findOne({ guildId: GLOBAL_SCOPE_GUILD_ID, userId })
      .select({ legacyMerged: 1 })
      .lean(),
    session
  );
  if (global?.legacyMerged) return;

  const legacy = await withSession(
    FreePackCooldown.find({ userId, guildId: { $ne: GLOBAL_SCOPE_GUILD_ID } })
      .select({ lastAt: 1 })
      .lean(),
    session
  );

  if (!legacy.length) {
    await FreePackCooldown.updateOne(
      { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
      { $set: { legacyMerged: true } },
      { upsert: true, session }
    );
    return;
  }

  let lastAt = null;
  for (const doc of legacy) {
    if (!doc?.lastAt) continue;
    const t = new Date(doc.lastAt);
    if (Number.isNaN(t.getTime())) continue;
    if (!lastAt || t.getTime() > lastAt.getTime()) lastAt = t;
  }

  await FreePackCooldown.updateOne(
    { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
    {
      $set: { legacyMerged: true, ...(lastAt ? { lastAt } : {}) }
    },
    { upsert: true, session }
  );

  await FreePackCooldown.deleteMany(
    { userId, guildId: { $ne: GLOBAL_SCOPE_GUILD_ID } },
    { session }
  );
}

export function getFreePackCooldownMs() {
  return COOLDOWN_MS;
}

export async function claimFreePack(guildId, userId) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  await ensureGlobalCooldownMerged(userId);

  const now = new Date();
  const cutoff = new Date(Date.now() - COOLDOWN_MS);

  const res = await FreePackCooldown.updateOne(
    {
      guildId: GLOBAL_SCOPE_GUILD_ID,
      userId,
      $or: [{ lastAt: { $lte: cutoff } }, { lastAt: null }, { lastAt: { $exists: false } }]
    },
    { $set: { lastAt: now } },
    { upsert: true }
  );

  const ok = (res.matchedCount ?? 0) > 0 || (res.upsertedCount ?? 0) > 0;
  if (ok) return { ok: true, remainingMs: 0, nextAt: new Date(Date.now() + COOLDOWN_MS) };

  const doc = await FreePackCooldown.findOne({ guildId: GLOBAL_SCOPE_GUILD_ID, userId }).lean();
  const last = doc?.lastAt ? new Date(doc.lastAt).getTime() : 0;
  const remainingMs = Math.max(0, COOLDOWN_MS - (Date.now() - last));

  return { ok: false, remainingMs, nextAt: new Date(Date.now() + remainingMs) };
}
