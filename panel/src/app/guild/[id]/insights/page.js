import { redirect } from "next/navigation";
import { fetchDiscord, hasManageGuild } from "../../../../lib/discord.js";
import { getSession } from "../../../../lib/session.js";
import { getGuildInsights } from "../../../../lib/insights.js";

function formatDate(value) {
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return "";
  }
}

export default async function GuildInsightsPage({ params }) {
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

  const insights = await getGuildInsights(guildId);

  return (
    <div className="page page-insights">
      <div className="grid">
        <div className="card hero">
          <div>
            <h1>Insights</h1>
            <p className="helper">
              Resumo do servidor com tickets, moderação e atividade recente.
            </p>
            <div className="hero-actions">
              <span className="stat">
                {insights.config.welcomeEnabled ? "Boas-vindas ON" : "Boas-vindas OFF"}
              </span>
              <span className="stat">
                {insights.config.automodEnabled ? "AutoMod ON" : "AutoMod OFF"}
              </span>
            </div>
          </div>
          <div className="badge">{guild.name}</div>
        </div>

        <div className="card">
          <h2>KPIs (7 dias)</h2>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi__label">Tickets abertos</div>
              <div className="kpi__value">{insights.kpis.openTickets}</div>
            </div>
            <div className="kpi">
              <div className="kpi__label">Tickets criados</div>
              <div className="kpi__value">{insights.kpis.ticketsCreated7d}</div>
            </div>
            <div className="kpi">
              <div className="kpi__label">Tickets fechados</div>
              <div className="kpi__value">{insights.kpis.ticketsClosed7d}</div>
            </div>
            <div className="kpi">
              <div className="kpi__label">Transcripts</div>
              <div className="kpi__value">{insights.kpis.transcripts7d}</div>
            </div>
            <div className="kpi">
              <div className="kpi__label">Infrações</div>
              <div className="kpi__value">{insights.kpis.infractions7d}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Tickets abertos por categoria</h2>
          {insights.openByCategory.length ? (
            <div className="list">
              {insights.openByCategory.map((row) => (
                <div key={row.label} className="list-row">
                  <span className="helper">{row.label}</span>
                  <span className="pill">{row.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="notice compact">Nenhum ticket aberto no momento.</div>
          )}
        </div>

        <div className="card">
          <h2>Tags mais usadas (30 dias)</h2>
          {insights.topTags30d.length ? (
            <div className="list">
              {insights.topTags30d.map((row) => (
                <div key={row.tag} className="list-row">
                  <span className="helper">{row.tag}</span>
                  <span className="pill">{row.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="notice compact">Nenhuma tag registrada ainda.</div>
          )}
        </div>

        <div className="card">
          <h2>Infrações recentes</h2>
          {insights.recentInfractions.length ? (
            <div className="list">
              {insights.recentInfractions.map((row) => (
                <div
                  key={`${row.type}:${row.userId}:${row.createdAt}`}
                  className="list-row list-row--stack"
                >
                  <div className="list-row__main">
                    <span className="pill">{row.type}</span>
                    <span className="helper">
                      usuário: {row.userId} • mod: {row.moderatorId}
                    </span>
                  </div>
                  <div className="mini">
                    {row.reason ? row.reason : "sem motivo"} • {formatDate(row.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="notice compact">Sem infrações recentes.</div>
          )}
        </div>
      </div>
    </div>
  );
}
