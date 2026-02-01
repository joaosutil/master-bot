import mongoose from "mongoose";

const InfractionSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    moderatorId: { type: String, required: true },
    type: {
      type: String,
      enum: ["warn", "timeout", "mute", "kick", "ban", "automod"],
      required: true
    },
    reason: { type: String },
    durationMs: { type: Number }
  },
  { timestamps: true }
);

export default mongoose.model("Infraction", InfractionSchema);
