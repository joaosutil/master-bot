import { connectDb } from "../../../lib/db.js";
import TicketTranscript from "../../../models/TicketTranscript.js";
import { fetchDiscordBot } from "../../../lib/discord.js";
import { env } from "../../../lib/env.js";

function extractIds(html, regex, limit = 25) {
  const ids = new Set();
  const text = String(html ?? "");
  const matches = text.matchAll(regex);
  for (const m of matches) {
    const id = m?.groups?.id ?? m?.[1];
    if (id) ids.add(String(id));
    if (ids.size >= limit) break;
  }
  return [...ids];
}

function injectMentionCss(html) {
  const css = `
    .mention { display:inline-block; padding:1px 6px; border-radius:999px; font-weight:700; }
    .mention-user { background: rgba(88,101,242,0.22); color:#c9d0ff; }
    .mention-role { background: rgba(235,69,158,0.18); color:#ffd1eb; }
    .mention-channel { background: rgba(53,231,255,0.12); color:#bff6ff; }
    .mention-special { background: rgba(255,209,102,0.18); color:#ffe4b0; }
  `;

  const text = String(html ?? "");
  if (text.includes(".mention-user") || text.includes("class=\\\"mention")) return text;

  const idx = text.indexOf("</style>");
  if (idx !== -1) {
    return text.slice(0, idx) + css + "\n" + text.slice(idx);
  }

  const headIdx = text.indexOf("</head>");
  if (headIdx !== -1) {
    return text.slice(0, headIdx) + `<style>${css}</style>` + text.slice(headIdx);
  }

  return `<style>${css}</style>` + text;
}

async function decorateTranscriptHtml(transcript) {
  const html = String(transcript?.html ?? "");
  if (!html) return "";

  // Se já está no formato novo (com spans), não mexe.
  if (html.includes("class=\\\"mention mention-user\\\"")) return html;

  const guildId = String(transcript.guildId ?? "");
  if (!guildId) return html;

  const userIds = extractIds(html, /(?:&lt;|<)@!?((?<id>\\d+))(?:&gt;|>)/g, 25);
  const roleIds = extractIds(html, /(?:&lt;|<)@&((?<id>\\d+))(?:&gt;|>)/g, 25);
  const channelIds = extractIds(html, /(?:&lt;|<)#((?<id>\\d+))(?:&gt;|>)/g, 25);

  let channelsById = {};
  let rolesById = {};
  const usersById = {};

  if (env.discordBotToken) {
    try {
      const [channels, roles] = await Promise.all([
        fetchDiscordBot(`/guilds/${guildId}/channels`, { botToken: env.discordBotToken }),
        fetchDiscordBot(`/guilds/${guildId}/roles`, { botToken: env.discordBotToken })
      ]);

      channelsById = Object.fromEntries((channels || []).map((c) => [String(c.id), c]));
      rolesById = Object.fromEntries((roles || []).map((r) => [String(r.id), r]));
    } catch {}

    await Promise.all(
      userIds.map(async (id) => {
        try {
          const user = await fetchDiscordBot(`/users/${id}`, { botToken: env.discordBotToken });
          usersById[id] = user?.global_name || user?.username || id;
        } catch {
          usersById[id] = id;
        }
      })
    );
  } else {
    for (const id of userIds) usersById[id] = id;
  }

  let out = injectMentionCss(html);

  out = out.replace(/&lt;@!?(\\d+)&gt;/g, (_, id) => {
    const name = usersById[String(id)] ?? id;
    return `<span class=\"mention mention-user\">@${name}</span>`;
  });
  out = out.replace(/<@!?(\\d+)>/g, (_, id) => {
    const name = usersById[String(id)] ?? id;
    return `<span class=\"mention mention-user\">@${name}</span>`;
  });

  out = out.replace(/&lt;@&(\\d+)&gt;/g, (_, id) => {
    const name = rolesById[String(id)]?.name ?? `cargo-${id}`;
    return `<span class=\"mention mention-role\">@${name}</span>`;
  });
  out = out.replace(/<@&(\\d+)>/g, (_, id) => {
    const name = rolesById[String(id)]?.name ?? `cargo-${id}`;
    return `<span class=\"mention mention-role\">@${name}</span>`;
  });

  out = out.replace(/&lt;#(\\d+)&gt;/g, (_, id) => {
    const name = channelsById[String(id)]?.name ?? `canal-${id}`;
    return `<span class=\"mention mention-channel\">#${name}</span>`;
  });
  out = out.replace(/<#(\\d+)>/g, (_, id) => {
    const name = channelsById[String(id)]?.name ?? `canal-${id}`;
    return `<span class=\"mention mention-channel\">#${name}</span>`;
  });

  return out;
}

export default async function TranscriptPage({ params }) {
  const transcriptId = params.id;

  await connectDb();
  const transcript = await TicketTranscript.findOne({ transcriptId });

  if (!transcript) {
    return (
      <div className="page page-transcript">
        <div className="card">
          <h1>Transcript não encontrado</h1>
          <p className="helper">O link pode estar expirado ou inválido.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-transcript">
      <div className="grid">
        <div className="card hero">
          <div>
            <h1>Transcript</h1>
            <p className="helper">Visualização do transcript salvo.</p>
          </div>
          <div className="badge">{transcriptId}</div>
        </div>
      <div className="card transcript-shell">
        <iframe
          className="transcript-frame"
          title="Transcript"
          srcDoc={await decorateTranscriptHtml(transcript)}
        />
      </div>
      </div>
    </div>
  );
}
