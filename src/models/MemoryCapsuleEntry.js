import mongoose from "mongoose";

const MemoryCapsuleEntrySchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
    messageUrl: { type: String, required: true },
    authorId: { type: String },
    content: { type: String },
    note: { type: String },
    usedAt: { type: Date }
  },
  { timestamps: true }
);

MemoryCapsuleEntrySchema.index(
  { guildId: 1, channelId: 1, messageId: 1 },
  { unique: true }
);

export default mongoose.model("MemoryCapsuleEntry", MemoryCapsuleEntrySchema);

