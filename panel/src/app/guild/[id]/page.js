import { redirect } from "next/navigation";
import { connectDb } from "../../../lib/db.js";
import { fetchDiscord, hasManageGuild } from "../../../lib/discord.js";
import { getSession } from "../../../lib/session.js";
import { getOrCreateGuildConfig } from "../../../lib/guildConfig.js";

export default async function GuildHomePage({ params }) {
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

  const guild = guilds.find(
    (item) => item.id === guildId && hasManageGuild(item.permissions)
  );

  if (!guild) {
    redirect("/dashboard");
  }

  await connectDb();
  const config = await getOrCreateGuildConfig(guildId);

  const ticketsCount = config.tickets?.categories?.length ?? 0;
  const welcomeEnabled = Boolean(config.welcome?.enabled);
  const automodEnabled = Boolean(config.moderation?.automod?.enabled);
  const vibeEnabled = Boolean(config.vibeCheck?.enabled);

  return (
    <div className="page page-dashboard">
      <div className="grid">
        <div className="card hero">
          <div>
            <h1>{guild.name}</h1>
            <p className="helper">
              Painel do servidor. Escolha o módulo que deseja configurar.
            </p>
          </div>
          <div className="badge">Guild {guildId}</div>
        </div>

        <div className="module-grid">
          <div className="card module-card">
            <div className="module-info">
              <strong>Tickets</strong>
              <span className="helper">
                {ticketsCount
                  ? `${ticketsCount} categoria(s) configurada(s)`
                  : "Nenhuma categoria configurada"}
              </span>
            </div>
            <div className="module-actions">
              <span
                className={`module-status ${ticketsCount ? "status-on" : "status-off"}`}
              >
                {ticketsCount ? "Ativo" : "Configurar"}
              </span>
              <a className="button" href={`/guild/${guildId}/tickets`}>
                Abrir
              </a>
            </div>
          </div>

          <div className="card module-card">
            <div className="module-info">
              <strong>Bem-vindo</strong>
              <span className="helper">
                {welcomeEnabled ? "Mensagem ativa" : "Desativado"}
              </span>
            </div>
            <div className="module-actions">
              <span
                className={`module-status ${welcomeEnabled ? "status-on" : "status-off"}`}
              >
                {welcomeEnabled ? "Ativo" : "Desativado"}
              </span>
              <a className="button" href={`/guild/${guildId}/welcome`}>
                Abrir
              </a>
            </div>
          </div>

          <div className="card module-card">
            <div className="module-info">
              <strong>Moderação</strong>
              <span className="helper">
                {automodEnabled
                  ? "Automod ativo"
                  : "Automod desativado"}
              </span>
            </div>
            <div className="module-actions">
              <span
                className={`module-status ${automodEnabled ? "status-on" : "status-off"}`}
              >
                {automodEnabled ? "Ativo" : "Configurar"}
              </span>
              <a className="button" href={`/guild/${guildId}/moderation`}>
                Abrir
              </a>
            </div>
          </div>

          <div className="card module-card">
            <div className="module-info">
              <strong>Verificação</strong>
              <span className="helper">
                Captcha (ephemeral) + cargo de verificado.
              </span>
            </div>
            <div className="module-actions">
              <span className="module-status status-on">Segurança</span>
              <a className="button" href={`/guild/${guildId}/verification`}>
                Abrir
              </a>
            </div>
          </div>

          <div className="card module-card">
            <div className="module-info">
              <strong>Insights</strong>
              <span className="helper">
                KPIs, tickets abertos por categoria e infrações recentes.
              </span>
            </div>
            <div className="module-actions">
              <span className="module-status status-on">Visão geral</span>
              <a className="button" href={`/guild/${guildId}/insights`}>
                Abrir
              </a>
            </div>
          </div>

          <div className="card module-card">
            <div className="module-info">
              <strong>Transcripts</strong>
              <span className="helper">
                Lista e busca de transcripts salvos pelo bot.
              </span>
            </div>
            <div className="module-actions">
              <span className="module-status status-on">Pesquisar</span>
              <a className="button" href={`/guild/${guildId}/transcripts`}>
                Abrir
              </a>
            </div>
          </div>

          <div className="card module-card">
            <div className="module-info">
              <strong>Cápsula do tempo</strong>
              <span className="helper">
                Memórias da comunidade (salvas via /memoria) com postagem automática.
              </span>
            </div>
            <div className="module-actions">
              <span className="module-status status-on">Diversão</span>
              <a className="button" href={`/guild/${guildId}/memories`}>
                Abrir
              </a>
            </div>
          </div>

          <div className="card module-card">
            <div className="module-info">
              <strong>Vibe Check</strong>
              <span className="helper">
                Termômetro diário da comunidade + “gêmeo de vibe”.
              </span>
            </div>
            <div className="module-actions">
              <span className={`module-status ${vibeEnabled ? "status-on" : "status-off"}`}>
                {vibeEnabled ? "Ativo" : "Configurar"}
              </span>
              <a className="button" href={`/guild/${guildId}/vibe`}>
                Abrir
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
