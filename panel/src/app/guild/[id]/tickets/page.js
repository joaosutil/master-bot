import { redirect } from "next/navigation";
import { connectDb } from "../../../../lib/db.js";
import { fetchDiscord, hasManageGuild } from "../../../../lib/discord.js";
import { getSession } from "../../../../lib/session.js";
import { getOrCreateGuildConfig } from "../../../../lib/guildConfig.js";
import TicketConfigClient from "./TicketConfigClient.js";

export default async function TicketConfigPage({ params, searchParams }) {
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

  const ticket = config.tickets ? config.tickets.toObject() : {};
  const panel = ticket.panel ?? {};

  const initialTicket = {
    type: ticket.type ?? "thread",
    openChannelId: ticket.openChannelId ?? "",
    staffRoleIds: ticket.staffRoleIds ?? [],
    categories: ticket.categories ?? [],
    formResponseTemplate: ticket.formResponseTemplate ?? "",
    autoClose: ticket.autoClose ?? {}
  };

  const initialPanel = {
    panelChannelId: panel.panelChannelId ?? "",
    panelTitle: panel.panelTitle ?? "",
    panelDescription: panel.panelDescription ?? "",
    panelPinned: panel.panelPinned ?? false,
    panelColor: panel.panelColor ?? "",
    panelFooterText: panel.panelFooterText ?? "",
    panelThumbnailUrl: panel.panelThumbnailUrl ?? "",
    panelImageUrl: panel.panelImageUrl ?? "",
    panelAuthorName: panel.panelAuthorName ?? "",
    panelAuthorIconUrl: panel.panelAuthorIconUrl ?? ""
  };

  const notices = [];
  if (searchParams?.saved) {
    notices.push({
      tone: "success",
      title: "Configuração salva",
      message: "As configurações foram atualizadas com sucesso."
    });
  }

  return (
    <div className="page page-tickets">
      <TicketConfigClient
        guildId={guildId}
        initialTicket={initialTicket}
        initialPanel={initialPanel}
        notices={notices}
        movedCount={0}
      />
    </div>
  );
}
