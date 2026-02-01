import mongoose from "mongoose";

const InventorySchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    counts: { type: Map, of: Number, default: {} }
  },
  { timestamps: true }
);

InventorySchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const Inventory =
  mongoose.models.Inventory ?? mongoose.model("Inventory", InventorySchema);

export async function addCardsToInventory(guildId, userId, cards) {
  const inc = {};
  for (const c of cards) {
    if (!c?.id) continue;
    inc[`counts.${c.id}`] = (inc[`counts.${c.id}`] ?? 0) + 1;
  }
  await Inventory.updateOne({ guildId, userId }, { $inc: inc }, { upsert: true });
}
