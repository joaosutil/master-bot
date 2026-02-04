import mongoose from "mongoose";

const SquadSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    formationId: { type: String, default: "4-4-2" },
    slots: { type: Map, of: String, default: {} },
    legacyMerged: { type: Boolean, default: false }
  },
  { timestamps: true }
);

SquadSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const Squad =
  mongoose.models.Squad ?? mongoose.model("Squad", SquadSchema);
