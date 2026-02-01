import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderDiscordMarkdown(value) {
  return renderDiscordMarkdownWithContext(value);
}

export function renderDiscordMarkdownWithContext(value, ctx = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  let html = md.render(raw);

  const protectedChunks = [];
  const protect = (regex) => {
    html = html.replace(regex, (match) => {
      const key = `@@MB_PROTECT_${protectedChunks.length}@@`;
      protectedChunks.push(match);
      return key;
    });
  };

  protect(/<pre><code[^>]*>[\s\S]*?<\/code><\/pre>/g);
  protect(/<code>[\s\S]*?<\/code>/g);

  html = html.replace(/&lt;@!?(\\d+)&gt;/g, (_, id) => {
    const name = ctx.usersById?.[id]?.name ?? ctx.usersById?.[id] ?? id;
    return `<span class="mention mention-user">@${escapeHtml(name)}</span>`;
  });

  html = html.replace(/&lt;@&(\\d+)&gt;/g, (_, id) => {
    const name = ctx.rolesById?.[id]?.name ?? ctx.rolesById?.[id] ?? `cargo-${id}`;
    return `<span class="mention mention-role">@${escapeHtml(name)}</span>`;
  });

  html = html.replace(/&lt;#(\\d+)&gt;/g, (_, id) => {
    const name = ctx.channelsById?.[id]?.name ?? ctx.channelsById?.[id] ?? `canal-${id}`;
    return `<span class="mention mention-channel">#${escapeHtml(name)}</span>`;
  });

  html = html.replace(
    /&lt;(a?):([a-zA-Z0-9_]+):(\\d+)&gt;/g,
    (_, animated, name, id) => {
      const ext = animated ? "gif" : "png";
      const alt = escapeHtml(`:${name}:`);
      return `<img class="emoji" alt="${alt}" src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=32&quality=lossless" />`;
    }
  );

  html = html.replace(/(^|[\\s>])(@everyone|@here)(?=\\s|<|$)/g, (m, p1, p2) => {
    return `${p1}<span class="mention mention-special">${escapeHtml(p2)}</span>`;
  });

  for (let i = 0; i < protectedChunks.length; i++) {
    html = html.replaceAll(`@@MB_PROTECT_${i}@@`, protectedChunks[i]);
  }

  return html;
}
