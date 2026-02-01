import { NextResponse } from "next/server";
import { fetchDiscordBot } from "../../../../lib/discord.js";
import { assertEnv, env } from "../../../../lib/env.js";
import { getSession } from "../../../../lib/session.js";

export const dynamic = "force-dynamic";

function normalizeIdsParam(value) {
  const ids = String(value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => /^\d+$/.test(v))
    .slice(0, 25);
  return [...new Set(ids)];
}

export async function GET(request) {
  assertEnv(["discordBotToken"]);

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const ids = normalizeIdsParam(searchParams.get("ids"));
  if (!ids.length) return NextResponse.json({ usersById: {} });

  try {
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const user = await fetchDiscordBot(`/users/${id}`, {
            botToken: env.discordBotToken
          });
          const name = user?.global_name || user?.username || id;
          return [id, { id, name }];
        } catch {
          return [id, { id, name: id }];
        }
      })
    );

    return NextResponse.json({ usersById: Object.fromEntries(results) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "discord_fetch_failed" }, { status: 500 });
  }
}
