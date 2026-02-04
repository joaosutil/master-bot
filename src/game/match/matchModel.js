import mongoose from "mongoose";

const MatchProfileSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },

    rankedMmr: { type: Number, default: 1000 },
    rankedWins: { type: Number, default: 0 },
    rankedDraws: { type: Number, default: 0 },
    rankedLosses: { type: Number, default: 0 },
    legacyMerged: { type: Boolean, default: false }
  },
  { timestamps: true }
);

MatchProfileSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const MatchProfile =
  mongoose.models.MatchProfile ?? mongoose.model("MatchProfile", MatchProfileSchema);
