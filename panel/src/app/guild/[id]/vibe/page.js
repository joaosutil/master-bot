import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
import { connectDb } from "../../../../lib/db.js";
import { fetchDiscord, hasManageGuild } from "../../../../lib/discord.js";
import { getSession } from "../../../../lib/session.js";
import { getOrCreateGuildConfig } from "../../../../lib/guildConfig.js";
import VibeConfigClient from "./VibeConfigClient.js";

export default async function VibeConfigPage({ params, searchParams }) {
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
  const vibe = config.vibeCheck ? config.vibeCheck.toObject?.() ?? config.vibeCheck : {};

  const initialVibe = {
    enabled: vibe.enabled ?? false,
    channelId: vibe.channelId ?? "",
    hour: typeof vibe.hour === "number" ? vibe.hour : 20,
    question: vibe.question ?? "",
    options: Array.isArray(vibe.options) ? vibe.options : []
  };

  const notices = [];
  if (searchParams?.saved) {
    notices.push({
      tone: "success",
      title: "Configuração salva",
      message: "As configurações do Vibe Check foram atualizadas."
    });
  }
  if (searchParams?.published) {
    notices.push({
      tone: "success",
      title: "Mensagem publicada",
      message: "O Vibe Check de hoje foi postado no canal selecionado."
    });
  }
  if (searchParams?.error === "missing_channel") {
    notices.push({
      tone: "error",
      title: "Canal obrigatório",
      message: "Defina um canal para ativar o Vibe Check."
    });
  }
  if (searchParams?.error === "channel_required") {
    notices.push({
      tone: "error",
      title: "Canal obrigatório",
      message: "Escolha um canal para publicar a mensagem."
    });
  }
  if (searchParams?.error === "publish_failed") {
    notices.push({
      tone: "error",
      title: "Falha ao publicar",
      message: "Verifique permissões do bot (Send Messages / Embed Links) e tente novamente."
    });
  }

  return (
    <div className="page page-vibe">
      <VibeConfigClient guildId={guildId} initialVibe={initialVibe} notices={notices} />
    </div>
  );
}

