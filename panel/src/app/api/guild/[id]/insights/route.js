import { NextResponse } from "next/server";
import { fetchDiscord, hasManageGuild } from "../../../../../lib/discord.js";
import { getSession } from "../../../../../lib/session.js";
import { getGuildInsights } from "../../../../../lib/insights.js";

export const dynamic = "force-dynamic";

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
    if (error?.status === 429) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: error.retryAfter ?? 1 },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: "discord_fetch_failed" }, { status: 500 });
  }

  const allowed = guilds.some(
    (guild) => guild.id === guildId && hasManageGuild(guild.permissions)
  );

  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const data = await getGuildInsights(guildId);
    return NextResponse.json(data);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "insights_failed" }, { status: 500 });
  }
}
