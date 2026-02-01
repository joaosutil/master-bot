import { redirect } from "next/navigation";
import { connectDb } from "../../../../lib/db.js";
import { fetchDiscord, hasManageGuild } from "../../../../lib/discord.js";
import { getSession } from "../../../../lib/session.js";
import { getOrCreateGuildConfig } from "../../../../lib/guildConfig.js";
import VerificationConfigClient from "./VerificationConfigClient.js";

export default async function VerificationPage({ params, searchParams }) {
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
  const verification = config.verification ? config.verification.toObject() : {};

  const initialVerification = {
    enabled: Boolean(verification.enabled),
    channelId: verification.channelId ?? "",
    messageId: verification.messageId ?? "",
    roleId: verification.roleId ?? "",
    removeRoleId: verification.removeRoleId ?? "",
    panel: {
      title: verification.panel?.title ?? "",
      description: verification.panel?.description ?? "",
      buttonLabel: verification.panel?.buttonLabel ?? "",
      color: verification.panel?.color ?? "",
      footerText: verification.panel?.footerText ?? ""
    },
    captcha: {
      difficulty: verification.captcha?.difficulty ?? "medium"
    }
  };

  const notices = [];
  if (searchParams?.saved) {
    notices.push({
      tone: "success",
      title: "Configuração salva",
      message: "A verificação foi atualizada."
    });
  }
  if (searchParams?.error) {
    const map = {
      missing_fields: "Para ativar, selecione canal e cargo.",
      remove_equals_role: "O cargo para remover não pode ser o mesmo cargo de verificado.",
      channel_required: "Escolha um canal para publicar.",
      role_required: "Defina o cargo verificado antes de publicar.",
      publish_failed: "Não foi possível publicar/editar a mensagem."
    };
    notices.push({
      tone: "error",
      title: "Erro",
      message: map[String(searchParams.error)] || "Ocorreu um erro."
    });
  }
  if (searchParams?.panel) {
    notices.push({
      tone: "success",
      title: "Painel publicado",
      message: "A mensagem de verificação foi enviada/atualizada."
    });
  }

  return (
    <div className="page page-dashboard">
      <VerificationConfigClient
        guildId={guildId}
        initialVerification={initialVerification}
        notices={notices}
      />
    </div>
  );
}
