import mongoose from "mongoose";

const GLOBAL_SCOPE_GUILD_ID = "global";

const PackStashSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    counts: { type: Map, of: Number, default: {} }
  },
  { timestamps: true }
);

PackStashSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const PackStash =
  mongoose.models.PackStash ?? mongoose.model("PackStash", PackStashSchema);

function withSession(query, session) {
  return session ? query.session(session) : query;
}

function toIncFromCounts(counts) {
  const inc = {};
  for (const [k, vRaw] of Object.entries(counts ?? {})) {
    const n = Math.trunc(Number(vRaw ?? 0));
    if (!Number.isFinite(n) || !n) continue;
    inc[`counts.${String(k)}`] = (inc[`counts.${String(k)}`] ?? 0) + n;
  }
  return inc;
}

async function ensureGlobalPackStashMerged(userId, { session } = {}) {
  const global = await withSession(
    PackStash.findOne({ guildId: GLOBAL_SCOPE_GUILD_ID, userId }).select({ legacyMerged: 1 }).lean(),
    session
  );
  if (global?.legacyMerged) return;

  const legacy = await withSession(
    PackStash.find({ userId, guildId: { $ne: GLOBAL_SCOPE_GUILD_ID } }).lean(),
    session
  );

  if (!legacy.length) {
    await PackStash.updateOne(
      { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
      { $set: { legacyMerged: true } },
      { upsert: true, session }
    );
    return;
  }

  const merged = {};
  for (const doc of legacy) {
    const counts = doc?.counts ? Object.fromEntries(Object.entries(doc.counts)) : {};
    for (const [k, v] of Object.entries(counts)) {
      const n = Math.trunc(Number(v ?? 0));
      if (!Number.isFinite(n) || n <= 0) continue;
      merged[String(k)] = (merged[String(k)] ?? 0) + n;
    }
  }

  const inc = toIncFromCounts(merged);
  await PackStash.updateOne(
    { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
    {
      ...(Object.keys(inc).length ? { $inc: inc } : {}),
      $set: { legacyMerged: true },
      $setOnInsert: { counts: {} }
    },
    { upsert: true, session }
  );

  await PackStash.deleteMany(
    { userId, guildId: { $ne: GLOBAL_SCOPE_GUILD_ID } },
    { session }
  );
}

export async function getPackCounts(guildId, userId) {
  await ensureGlobalPackStashMerged(userId);
  const doc = await PackStash.findOne({ guildId: GLOBAL_SCOPE_GUILD_ID, userId }).lean();
  return doc?.counts ? Object.fromEntries(Object.entries(doc.counts)) : {};
}

export async function addPackToStash(guildId, userId, packId, qty, { session } = {}) {
  await ensureGlobalPackStashMerged(userId, { session });
  await PackStash.updateOne(
    { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
    { $inc: { [`counts.${packId}`]: qty } },
    { upsert: true, session }
  );
}

export async function consumePackFromStash(guildId, userId, packId, qty = 1, { session } = {}) {
  await ensureGlobalPackStashMerged(userId, { session });
  const updated = await PackStash.findOneAndUpdate(
    { guildId: GLOBAL_SCOPE_GUILD_ID, userId, [`counts.${packId}`]: { $gte: qty } },
    { $inc: { [`counts.${packId}`]: -qty } },
    { new: true, session }
  ).lean();

  if (!updated) return { ok: false, left: 0 };
  const left = updated?.counts?.[packId] ?? 0;
  return { ok: true, left };
}
