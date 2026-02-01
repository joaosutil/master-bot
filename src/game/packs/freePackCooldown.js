import mongoose from "mongoose";

const COOLDOWN_MS = 10 * 60 * 1000;

const FreePackCooldownSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    lastAt: { type: Date, default: null }
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

export function getFreePackCooldownMs() {
  return COOLDOWN_MS;
}

export async function claimFreePack(guildId, userId) {
  if (!isMongoConnected()) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const now = new Date();
  const cutoff = new Date(Date.now() - COOLDOWN_MS);

  const res = await FreePackCooldown.updateOne(
    {
      guildId,
      userId,
      $or: [{ lastAt: { $lte: cutoff } }, { lastAt: null }, { lastAt: { $exists: false } }]
    },
    { $set: { lastAt: now } },
    { upsert: true }
  );

  const ok = (res.matchedCount ?? 0) > 0 || (res.upsertedCount ?? 0) > 0;
  if (ok) return { ok: true, remainingMs: 0, nextAt: new Date(Date.now() + COOLDOWN_MS) };

  const doc = await FreePackCooldown.findOne({ guildId, userId }).lean();
  const last = doc?.lastAt ? new Date(doc.lastAt).getTime() : 0;
  const remainingMs = Math.max(0, COOLDOWN_MS - (Date.now() - last));

  return { ok: false, remainingMs, nextAt: new Date(Date.now() + remainingMs) };
}

