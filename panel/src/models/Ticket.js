import mongoose from "mongoose";

const TicketSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    ownerId: { type: String, required: true },
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open"
    },
    categoryLabel: { type: String },
    categoryKey: { type: String, required: true, default: "geral", index: true },
    lastActivityAt: { type: Date },
    autoCloseWarnedAt: { type: Date },
    tag: { type: String },
    claimedBy: { type: String },
    closedAt: { type: Date }
  },
  { timestamps: true }
);

TicketSchema.index(
  { guildId: 1, ownerId: 1, categoryKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: "open"
    }
  }
);

TicketSchema.index({ guildId: 1, status: 1, lastActivityAt: 1 });

export default mongoose.models.Ticket ||
  mongoose.model("Ticket", TicketSchema);
