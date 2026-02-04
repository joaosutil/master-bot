import mongoose from "mongoose";

const economySchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    version: { type: Number, default: 2 },
    balance: { type: Number, default: 0 },
    lastDaily: { type: Number, default: 0 }, // Date.now()
    lastWeekly: { type: Number, default: 0 }, // Date.now()

    // internal flags for the global economy migration (kept in schema so strict updates won't strip it)
    legacyMerged: { type: Boolean, default: false },
    initialized: { type: Boolean, default: false }
  },
  { timestamps: true }
);

economySchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const EconomyUser =
  mongoose.models.EconomyUser || mongoose.model("EconomyUser", economySchema);
