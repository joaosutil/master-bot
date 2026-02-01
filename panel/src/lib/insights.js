import { connectDb } from "./db.js";
import GuildConfig from "../models/GuildConfig.js";
import Infraction from "../models/Infraction.js";
import Ticket from "../models/Ticket.js";
import TicketTranscript from "../models/TicketTranscript.js";

function daysAgo(days) {
  return new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
}

export async function getGuildInsights(guildId) {
  const id = String(guildId ?? "");
  if (!id) throw new Error("guildId is required");

  await connectDb();

  const since7d = daysAgo(7);
  const since30d = daysAgo(30);

  const [
    config,
    openTickets,
    ticketsCreated7d,
    ticketsClosed7d,
    transcripts7d,
    infractions7d,
    openByCategory,
    topTags30d,
    recentInfractions
  ] = await Promise.all([
    GuildConfig.findOne({ guildId: id }).lean(),
    Ticket.countDocuments({ guildId: id, status: "open" }),
    Ticket.countDocuments({ guildId: id, createdAt: { $gte: since7d } }),
    Ticket.countDocuments({ guildId: id, status: "closed", closedAt: { $gte: since7d } }),
    TicketTranscript.countDocuments({ guildId: id, createdAt: { $gte: since7d } }),
    Infraction.countDocuments({ guildId: id, createdAt: { $gte: since7d } }),
    Ticket.aggregate([
      { $match: { guildId: id, status: "open" } },
      {
        $group: {
          _id: { $ifNull: ["$categoryLabel", "$categoryKey"] },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]),
    Ticket.aggregate([
      {
        $match: {
          guildId: id,
          status: "closed",
          closedAt: { $gte: since30d },
          tag: { $type: "string", $ne: "" }
        }
      },
      { $group: { _id: "$tag", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 }
    ]),
    Infraction.find({ guildId: id })
      .sort({ createdAt: -1 })
      .limit(12)
      .select({ type: 1, userId: 1, moderatorId: 1, reason: 1, createdAt: 1, _id: 0 })
      .lean()
  ]);

  return {
    config: {
      ticketsCategories: config?.tickets?.categories?.length ?? 0,
      welcomeEnabled: Boolean(config?.welcome?.enabled),
      automodEnabled: Boolean(config?.moderation?.automod?.enabled)
    },
    kpis: {
      openTickets,
      ticketsCreated7d,
      ticketsClosed7d,
      transcripts7d,
      infractions7d
    },
    openByCategory: (openByCategory || []).map((row) => ({
      label: String(row._id ?? "geral"),
      count: Number(row.count ?? 0)
    })),
    topTags30d: (topTags30d || []).map((row) => ({
      tag: String(row._id ?? ""),
      count: Number(row.count ?? 0)
    })),
    recentInfractions: (recentInfractions || []).map((row) => ({
      type: row.type,
      userId: row.userId,
      moderatorId: row.moderatorId,
      reason: row.reason,
      createdAt: row.createdAt
    }))
  };
}

