import mongoose from "mongoose";

const TicketTranscriptSchema = new mongoose.Schema(
  {
    transcriptId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    ownerId: { type: String },
    messageCount: { type: Number, default: 0 },
    markdown: { type: String },
    html: { type: String }
  },
  { timestamps: true }
);

export default mongoose.models.TicketTranscript ||
  mongoose.model("TicketTranscript", TicketTranscriptSchema);
