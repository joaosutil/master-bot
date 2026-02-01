import { redirect } from "next/navigation";
import { getSession } from "../../lib/session.js";
import { fetchDiscord, hasManageGuild } from "../../lib/discord.js";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  let guilds = [];
  try {
    guilds = await fetchDiscord("/users/@me/guilds", {
      token: session.accessToken
    });
  } catch (error) {
    console.error(error);
  }

  const manageable = guilds.filter((guild) => hasManageGuild(guild.permissions));

  return (
    <div className="page page-dashboard">
      <div className="grid">
        <div className="card hero">
          <div>
            <h1>Servidores</h1>
            <p className="helper">
              Selecione um servidor onde você tenha Manage Guild.
            </p>
          </div>
          <div className="badge">Acesso validado</div>
        </div>
        {manageable.length === 0 ? (
          <div className="notice">
            Nenhum servidor com permissão Manage Guild encontrado.
          </div>
        ) : (
          manageable.map((guild) => (
            <div className="card guild-card" key={guild.id}>
              <div className="guild-info">
                <div className="guild-icon">
                  {guild.icon ? (
                    <img
                      src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=96`}
                      alt={guild.name}
                    />
                  ) : (
                    guild.name.slice(0, 1).toUpperCase()
                  )}
                </div>
                <div>
                  <strong>{guild.name}</strong>
                  <div className="helper">ID: {guild.id}</div>
                </div>
              </div>
              <a className="button" href={`/guild/${guild.id}`}>
                Abrir painel
              </a>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
