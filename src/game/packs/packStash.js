import mongoose from "mongoose";

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

export async function getPackCounts(guildId, userId) {
  const doc = await PackStash.findOne({ guildId, userId }).lean();
  return doc?.counts ? Object.fromEntries(Object.entries(doc.counts)) : {};
}

export async function addPackToStash(guildId, userId, packId, qty, { session } = {}) {
  await PackStash.updateOne(
    { guildId, userId },
    { $inc: { [`counts.${packId}`]: qty } },
    { upsert: true, session }
  );
}

export async function consumePackFromStash(guildId, userId, packId, qty = 1, { session } = {}) {
  const updated = await PackStash.findOneAndUpdate(
    { guildId, userId, [`counts.${packId}`]: { $gte: qty } },
    { $inc: { [`counts.${packId}`]: -qty } },
    { new: true, session }
  ).lean();

  if (!updated) return { ok: false, left: 0 };
  const left = updated?.counts?.[packId] ?? 0;
  return { ok: true, left };
}
