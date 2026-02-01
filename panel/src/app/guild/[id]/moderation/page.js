import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
import { connectDb } from "../../../../lib/db.js";
import { fetchDiscord, hasManageGuild } from "../../../../lib/discord.js";
import { getSession } from "../../../../lib/session.js";
import { getOrCreateGuildConfig } from "../../../../lib/guildConfig.js";
import ModerationConfigClient from "./ModerationConfigClient.js";

export default async function ModerationConfigPage({ params, searchParams }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
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
    redirect("/dashboard");
  }

  await connectDb();
  const config = await getOrCreateGuildConfig(guildId);
  const moderation = config.moderation
    ? config.moderation.toObject?.() ?? config.moderation
    : {};
  const automod = moderation.automod ?? {};
  const antiFlood = automod.antiFlood ?? {};
  const antiSpam = automod.antiSpam ?? {};
  const antiLink = automod.antiLink ?? {};
  const wordFilter = automod.wordFilter ?? {};
  const raidDetection = automod.raidDetection ?? {};

  const initialModeration = {
    logChannelId: moderation.logChannelId ?? "",
    automod: {
      enabled: automod.enabled ?? false,
      antiFlood: {
        enabled: antiFlood.enabled ?? false,
        maxMessages: antiFlood.maxMessages ?? 6,
        intervalSeconds: antiFlood.intervalSeconds ?? 8,
        timeoutMinutes: antiFlood.timeoutMinutes ?? 2,
        deleteMessages: antiFlood.deleteMessages ?? true
      },
      antiSpam: {
        enabled: antiSpam.enabled ?? false,
        maxDuplicates: antiSpam.maxDuplicates ?? 3,
        intervalSeconds: antiSpam.intervalSeconds ?? 10,
        timeoutMinutes: antiSpam.timeoutMinutes ?? 2,
        deleteMessages: antiSpam.deleteMessages ?? true
      },
      antiLink: {
        enabled: antiLink.enabled ?? false,
        allowedRoleIds: antiLink.allowedRoleIds ?? [],
        allowedChannelIds: antiLink.allowedChannelIds ?? [],
        timeoutMinutes: antiLink.timeoutMinutes ?? 0,
        deleteMessages: antiLink.deleteMessages ?? true
      },
      wordFilter: {
        enabled: wordFilter.enabled ?? false,
        words: wordFilter.words ?? [],
        timeoutMinutes: wordFilter.timeoutMinutes ?? 0,
        deleteMessages: wordFilter.deleteMessages ?? true
      },
      raidDetection: {
        enabled: raidDetection.enabled ?? false,
        maxJoins: raidDetection.maxJoins ?? 6,
        intervalSeconds: raidDetection.intervalSeconds ?? 12
      }
    }
  };

  const notices = [];
  if (searchParams?.saved) {
    notices.push({
      tone: "success",
      title: "Configuração salva",
      message: "As configurações de moderação foram atualizadas."
    });
  }

  return (
    <div className="page page-moderation">
      <ModerationConfigClient
        guildId={guildId}
        initialModeration={initialModeration}
        notices={notices}
      />
    </div>
  );
}
