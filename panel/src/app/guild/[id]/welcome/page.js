import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
import { connectDb } from "../../../../lib/db.js";
import { fetchDiscord, hasManageGuild } from "../../../../lib/discord.js";
import { getSession } from "../../../../lib/session.js";
import { getOrCreateGuildConfig } from "../../../../lib/guildConfig.js";
import WelcomeConfigClient from "./WelcomeConfigClient.js";

export default async function WelcomeConfigPage({ params, searchParams }) {
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
  const welcome = config.welcome ? config.welcome.toObject?.() ?? config.welcome : {};

  const initialWelcome = {
    enabled: welcome.enabled ?? false,
    channelId: welcome.channelId ?? "",
    title: welcome.title ?? "",
    description: welcome.description ?? "",
    color: welcome.color ?? "",
    footerText: welcome.footerText ?? "",
    thumbnailUrl: welcome.thumbnailUrl ?? "",
    imageUrl: welcome.imageUrl ?? "",
    authorName: welcome.authorName ?? "",
    authorIconUrl: welcome.authorIconUrl ?? ""
  };

  const notices = [];
  if (searchParams?.saved) {
    notices.push({
      tone: "success",
      title: "Configuração salva",
      message: "As configurações de boas-vindas foram atualizadas."
    });
  }

  if (searchParams?.error === "channel_required") {
    notices.push({
      tone: "error",
      title: "Canal obrigatório",
      message: "Defina um canal para ativar as boas-vindas."
    });
  }

  return (
    <div className="page page-welcome">
      <WelcomeConfigClient
        guildId={guildId}
        initialWelcome={initialWelcome}
        notices={notices}
      />
    </div>
  );
}
