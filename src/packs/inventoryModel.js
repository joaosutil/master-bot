import mongoose from "mongoose";

const invSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    counts: { type: Map, of: Number, default: {} }
  },
  { timestamps: true }
);

invSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const Inventory =
  mongoose.models.Inventory || mongoose.model("Inventory", invSchema);

export async function getInventoryCounts(guildId, userId) {
  const doc = await Inventory.findOne({ guildId, userId }).lean();
  if (doc?.counts) return Object.fromEntries(Object.entries(doc.counts));

  // compat: inventários antigos (cards: [{cardId,count}])
  if (Array.isArray(doc?.cards)) {
    const out = {};
    for (const it of doc.cards) {
      if (!it?.cardId) continue;
      const n = Number(it.count ?? 0);
      if (!Number.isFinite(n) || n <= 0) continue;
      out[String(it.cardId)] = (out[String(it.cardId)] ?? 0) + n;
    }
    return out;
  }

  return {};
}

export function inventoryTotalCount(counts = {}) {
  let total = 0;
  for (const v of Object.values(counts ?? {})) {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    total += Math.trunc(n);
  }
  return total;
}

export async function getInventoryTotalCount(guildId, userId) {
  const counts = await getInventoryCounts(guildId, userId);
  return inventoryTotalCount(counts);
}

export async function addCardsToInventory(guildId, userId, cards, { session } = {}) {
  const inc = {};
  for (const c of cards ?? []) {
    if (!c?.id) continue;
    inc[`counts.${c.id}`] = (inc[`counts.${c.id}`] ?? 0) + 1;
  }
  if (!Object.keys(inc).length) return;
  await Inventory.updateOne({ guildId, userId }, { $inc: inc }, { upsert: true, session });
}
