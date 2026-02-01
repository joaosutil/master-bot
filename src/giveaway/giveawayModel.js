import mongoose from "mongoose";

const GiveawaySchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    messageId: { type: String, required: true, index: true },

    hostId: { type: String, required: true, index: true },
    prize: { type: String, required: true },
    winnersCount: { type: Number, default: 1, min: 1, max: 20 },

    title: { type: String, default: "🎉 Sorteio" },
    description: { type: String, default: null },
    mention: { type: String, default: null }, // ex: "@everyone" ou "<@&roleId>"

    requiredRoleId: { type: String, default: null },
    blockedRoleId: { type: String, default: null },

    endsAt: { type: Date, required: true, index: true },
    endedAt: { type: Date, default: null, index: true },

    participants: { type: [String], default: [] },
    winners: { type: [String], default: [] }
  },
  { timestamps: true }
);

export const Giveaway =
  mongoose.models.Giveaway ?? mongoose.model("Giveaway", GiveawaySchema);

