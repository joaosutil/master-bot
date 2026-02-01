import { redirect } from "next/navigation";
import { connectDb } from "../../../../lib/db.js";
import { fetchDiscord, hasManageGuild } from "../../../../lib/discord.js";
import { getSession } from "../../../../lib/session.js";
import TicketTranscript from "../../../../models/TicketTranscript.js";

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

export default async function GuildTranscriptsPage({ params, searchParams }) {
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
  const filter = { guildId };
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ transcriptId: rx }, { ownerId: rx }, { channelId: rx }];
  }

  const transcripts = await TicketTranscript.find(filter)
    .sort({ createdAt: -1 })
    .limit(30)
    .select({ transcriptId: 1, ownerId: 1, channelId: 1, messageCount: 1, createdAt: 1, _id: 0 })
    .lean();

  return (
    <div className="page page-transcripts">
      <div className="grid">
        <div className="card hero">
          <div>
            <h1>Transcripts</h1>
            <p className="helper">
              Pesquise por transcriptId, userId ou channelId. Clique para abrir o transcript.
            </p>
            <div className="hero-actions">
              <span className="stat">{transcripts.length} recentes</span>
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
              <a className="button button--sm button--secondary" href={`/guild/${guildId}/transcripts`}>
                Limpar
              </a>
            ) : null}
          </form>

          {transcripts.length ? (
            <div className="table">
              <div className="table__head">
                <span>Transcript</span>
                <span>Canal</span>
                <span>Owner</span>
                <span>Msgs</span>
                <span>Data</span>
                <span />
              </div>
              {transcripts.map((t) => (
                <div key={t.transcriptId} className="table__row">
                  <span className="mono">{t.transcriptId}</span>
                  <span className="mono">{t.channelId}</span>
                  <span className="mono">{t.ownerId || "-"}</span>
                  <span>{t.messageCount ?? 0}</span>
                  <span className="mini">{formatDate(t.createdAt)}</span>
                  <a className="button button--sm" href={`/transcript/${t.transcriptId}`}>
                    Abrir
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div className="notice compact">Nenhum transcript encontrado.</div>
          )}
        </div>
      </div>
    </div>
  );
}
