import { NextResponse } from "next/server";
import { connectDb } from "../../../../../lib/db.js";
import { fetchDiscord, hasManageGuild } from "../../../../../lib/discord.js";
import { getSession } from "../../../../../lib/session.js";
import TicketTranscript from "../../../../../models/TicketTranscript.js";

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request, { params }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const guildId = params.id;

  let guilds = [];
  try {
    guilds = await fetchDiscord("/users/@me/guilds", {
      token: session.accessToken
    });
  } catch (error) {
    console.error(error);
  }

  const allowed = guilds.some(
    (guild) => guild.id === guildId && hasManageGuild(guild.permissions)
  );

  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 20)));

  const filter = { guildId };
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [
      { transcriptId: rx },
      { ownerId: rx },
      { channelId: rx }
    ];
  }

  await connectDb();
  const transcripts = await TicketTranscript.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .select({ transcriptId: 1, ownerId: 1, channelId: 1, messageCount: 1, createdAt: 1, _id: 0 })
    .lean();

  return NextResponse.json({ transcripts });
}

