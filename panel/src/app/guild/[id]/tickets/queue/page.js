import { redirect } from "next/navigation";
import { connectDb } from "../../../../../lib/db.js";
import { fetchDiscord, hasManageGuild } from "../../../../../lib/discord.js";
import { getSession } from "../../../../../lib/session.js";
import Ticket from "../../../../../models/Ticket.js";

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return "";
  }
}

export default async function TicketQueuePage({ params, searchParams }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const guildId = params.id;
  const q = String(searchParams?.q ?? "").trim();

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

  const filter = { guildId, status: "open" };
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ ownerId: rx }, { channelId: rx }, { categoryLabel: rx }];
  }

  const tickets = await Ticket.find(filter)
    .sort({ lastActivityAt: -1, createdAt: -1 })
    .limit(50)
    .select({
      channelId: 1,
      ownerId: 1,
      categoryLabel: 1,
      claimedBy: 1,
      createdAt: 1,
      lastActivityAt: 1,
      autoCloseWarnedAt: 1,
      _id: 0
    })
    .lean();

  return (
    <div className="page page-tickets">
      <div className="grid">
        <div className="card hero">
          <div>
            <h1>Fila de tickets</h1>
            <p className="helper">
              Tickets abertos no momento. Pesquise por userId, channelId ou categoria.
            </p>
            <div className="hero-actions">
              <span className="stat">{tickets.length} abertos</span>
            </div>
          </div>
          <div className="badge">{guild.name}</div>
        </div>

        <div className="card">
          <form className="form-row" action="" method="get">
            <input
              name="q"
              placeholder="Buscar..."
              defaultValue={q}
              autoComplete="off"
            />
            <button className="button button--sm" type="submit">
              Buscar
            </button>
            {q ? (
              <a className="button button--sm button--secondary" href={`/guild/${guildId}/tickets/queue`}>
                Limpar
              </a>
            ) : null}
          </form>

          {tickets.length ? (
            <div className="table">
              <div className="table__head">
                <span>Canal</span>
                <span>Categoria</span>
                <span>Owner</span>
                <span>Claim</span>
                <span>Atividade</span>
                <span />
              </div>
              {tickets.map((t) => {
                const last = t.lastActivityAt || t.createdAt;
                const discordUrl = `https://discord.com/channels/${guildId}/${t.channelId}`;
                return (
                  <div key={t.channelId} className="table__row">
                    <span className="mono">{t.channelId}</span>
                    <span className="helper">{t.categoryLabel || "-"}</span>
                    <span className="mono">{t.ownerId}</span>
                    <span className="mono">{t.claimedBy || "-"}</span>
                    <span className="mini">
                      {formatDate(last)}
                      {t.autoCloseWarnedAt ? " • avisado" : ""}
                    </span>
                    <a className="button button--sm" href={discordUrl} target="_blank" rel="noreferrer">
                      Abrir no Discord
                    </a>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="notice compact">Nenhum ticket aberto.</div>
          )}
        </div>
      </div>
    </div>
  );
}
