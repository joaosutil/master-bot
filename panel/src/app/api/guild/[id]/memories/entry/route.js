import { NextResponse } from "next/server";
import { connectDb } from "../../../../../../lib/db.js";
import { fetchDiscord, hasManageGuild } from "../../../../../../lib/discord.js";
import { env } from "../../../../../../lib/env.js";
import { getBaseUrlFromRequest } from "../../../../../../lib/runtimeUrl.js";
import { getSession } from "../../../../../../lib/session.js";
import MemoryCapsuleEntry from "../../../../../../models/MemoryCapsuleEntry.js";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const baseUrl = getBaseUrlFromRequest(request);
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(`${baseUrl}/login`);
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
    return NextResponse.redirect(`${baseUrl}/dashboard`);
  }

  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const entryId = String(form.get("entryId") ?? "").trim();

  if (!entryId) {
    return NextResponse.redirect(`${baseUrl}/guild/${guildId}/memories?error=entry`);
  }

  await connectDb();

  if (action === "delete") {
    await MemoryCapsuleEntry.deleteOne({ _id: entryId, guildId });
  } else if (action === "reset") {
    await MemoryCapsuleEntry.updateOne(
      { _id: entryId, guildId },
      { $set: { usedAt: null } }
    );
  }

  return NextResponse.redirect(`${baseUrl}/guild/${guildId}/memories?saved=1`);
}
