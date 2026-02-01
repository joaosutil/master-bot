import mongoose from "mongoose";

const VibeCheckOptionSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true },
    emoji: { type: String, trim: true },
    label: { type: String, trim: true }
  },
  { _id: false }
);

const VibeCheckDaySchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    dateKey: { type: String, required: true, index: true }, // YYYY-MM-DD (UTC)
    channelId: { type: String },
    messageId: { type: String },
    question: { type: String, trim: true },
    options: { type: [VibeCheckOptionSchema], default: [] },
    counts: { type: Map, of: Number, default: () => ({}) },
    responses: { type: Map, of: String, default: () => ({}) }
  },
  { timestamps: true }
);

VibeCheckDaySchema.index({ guildId: 1, dateKey: 1 }, { unique: true });

export default mongoose.model("VibeCheckDay", VibeCheckDaySchema);

