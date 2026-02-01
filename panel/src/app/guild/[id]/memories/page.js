import { redirect } from "next/navigation";
import { connectDb } from "../../../../lib/db.js";
import { fetchDiscord, fetchDiscordBot, hasManageGuild } from "../../../../lib/discord.js";
import { env } from "../../../../lib/env.js";
import { getSession } from "../../../../lib/session.js";
import { getOrCreateGuildConfig } from "../../../../lib/guildConfig.js";
import MemoryCapsuleEntry from "../../../../models/MemoryCapsuleEntry.js";

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

export default async function GuildMemoriesPage({ params, searchParams }) {
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
  const config = await getOrCreateGuildConfig(guildId);
  const memory = config.memoryCapsule ? config.memoryCapsule.toObject() : {};

  let channels = [];
  if (env.discordBotToken) {
    try {
      channels = await fetchDiscordBot(`/guilds/${guildId}/channels`, {
        botToken: env.discordBotToken
      });
    } catch {}
  }

  const textChannels = (channels || [])
    .filter((c) => c && (c.type === 0 || c.type === 5))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const filter = { guildId };
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ authorId: rx }, { channelId: rx }, { content: rx }, { note: rx }];
  }

  const entries = await MemoryCapsuleEntry.find(filter)
    .sort({ createdAt: -1 })
    .limit(40)
    .select({ messageUrl: 1, channelId: 1, authorId: 1, content: 1, note: 1, usedAt: 1, createdAt: 1 })
    .lean();

  const notices = [];
  if (searchParams?.saved) {
    notices.push({
      tone: "success",
      title: "Atualizado",
      message: "Configuração/ação salva com sucesso."
    });
  }

  return (
    <div className="page page-memories">
      <div className="grid">
        <div className="card hero">
          <div>
            <h1>Cápsula do tempo</h1>
            <p className="helper">
              Memórias engraçadas/fofas do servidor. A galera salva pelo comando /memoria adicionar e o bot posta automaticamente.
            </p>
            <div className="hero-actions">
              <span className="stat">{entries.length} memórias (últimas)</span>
            </div>
          </div>
          <div className="badge">{guild.name}</div>
        </div>

        {notices.length ? (
          <div className="notice-stack">
            {notices.map((notice, index) => (
              <div key={index} className={`notice ${notice.tone || "info"}`}>
                <strong>{notice.title}</strong>
                <span className="helper">{notice.message}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="card">
          <h2>Configuração</h2>
          <form className="form" method="post" action={`/api/guild/${guildId}/memories`}>
            <div className="field">
              <label>Ativar cápsula</label>
              <div className="toggle-row">
                <input type="checkbox" name="enabled" defaultChecked={Boolean(memory.enabled)} />
                <span>Postar automaticamente no canal configurado.</span>
              </div>
            </div>

            <div className="field">
              <label>Canal de postagem</label>
              <select name="channelId" defaultValue={memory.channelId || ""}>
                <option value="">(nenhum)</option>
                {textChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="field">
                <label>Cadência</label>
                <select name="cadence" defaultValue={memory.cadence === "daily" ? "daily" : "weekly"}>
                  <option value="weekly">Semanal</option>
                  <option value="daily">Diária</option>
                </select>
              </div>
              <div className="field">
                <label>Hora</label>
                <select name="hour" defaultValue={String(memory.hour ?? 20)}>
                  {Array.from({ length: 24 }).map((_, i) => (
                    <option key={i} value={String(i)}>
                      {String(i).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="helper">
              Dica: o bot usa o horário do servidor onde ele está rodando. Para testar, use /memoria postar (Manage Guild).
            </p>

            <button className="button" type="submit">
              Salvar cápsula
            </button>
          </form>
        </div>

        <div className="card">
          <h2>Memórias salvas</h2>
          <form className="form-row" action="" method="get">
            <input name="q" placeholder="Buscar..." defaultValue={q} autoComplete="off" />
            <button className="button button--sm" type="submit">
              Buscar
            </button>
            {q ? (
              <a className="button button--sm button--secondary" href={`/guild/${guildId}/memories`}>
                Limpar
              </a>
            ) : null}
          </form>

          {entries.length ? (
            <div className="table">
              <div className="table__head">
                <span>Texto</span>
                <span>Canal</span>
                <span>Autor</span>
                <span>Usada</span>
                <span>Criada</span>
                <span />
              </div>

              {entries.map((e) => (
                <div key={String(e._id)} className="table__row">
                  <span className="helper">
                    {e.note ? `📝 ${String(e.note).slice(0, 60)} ` : ""}
                    {e.content ? `“${String(e.content).slice(0, 70)}”` : "(sem texto)"}
                  </span>
                  <span className="mono">{e.channelId}</span>
                  <span className="mono">{e.authorId || "-"}</span>
                  <span className="mini">{e.usedAt ? formatDate(e.usedAt) : "-"}</span>
                  <span className="mini">{formatDate(e.createdAt)}</span>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <a className="button button--sm" href={e.messageUrl} target="_blank" rel="noreferrer">
                      Abrir
                    </a>
                    <form method="post" action={`/api/guild/${guildId}/memories/entry`}>
                      <input type="hidden" name="entryId" value={String(e._id)} />
                      <input type="hidden" name="action" value="reset" />
                      <button className="button button--sm button--secondary" type="submit" disabled={!e.usedAt}>
                        Reusar
                      </button>
                    </form>
                    <form method="post" action={`/api/guild/${guildId}/memories/entry`}>
                      <input type="hidden" name="entryId" value={String(e._id)} />
                      <input type="hidden" name="action" value="delete" />
                      <button className="button button--sm button--danger" type="submit">
                        Apagar
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="notice compact">Nenhuma memória salva ainda.</div>
          )}
        </div>
      </div>
    </div>
  );
}
