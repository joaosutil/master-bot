"use client";

import { useEffect, useMemo, useState } from "react";
import { renderDiscordMarkdownWithContext } from "../../../../lib/discordMarkdown.js";

const CHANNEL_TYPES = {
  GUILD_TEXT: 0,
  GUILD_ANNOUNCEMENT: 5,
  GUILD_CATEGORY: 4
};

export default function WelcomeConfigClient({
  guildId,
  initialWelcome,
  notices = []
}) {
  const [enabled, setEnabled] = useState(initialWelcome.enabled ?? false);
  const [channelId, setChannelId] = useState(initialWelcome.channelId || "");
  const [autoRoleIds, setAutoRoleIds] = useState(
    Array.isArray(initialWelcome.autoRoleIds) ? initialWelcome.autoRoleIds : []
  );
  const [roleSearch, setRoleSearch] = useState("");
  const [channelSearch, setChannelSearch] = useState("");
  const [title, setTitle] = useState(
    initialWelcome.title || "Bem-vindo(a), {username}!"
  );
  const [description, setDescription] = useState(
    initialWelcome.description || "Sinta-se em casa no servidor, {user}."
  );
  const normalizedInitialColor = (initialWelcome.color || "#2fffe0").startsWith("#")
    ? initialWelcome.color || "#2fffe0"
    : `#${initialWelcome.color}`;
  const [color, setColor] = useState(normalizedInitialColor);
  const [colorText, setColorText] = useState(normalizedInitialColor);
  const [authorName, setAuthorName] = useState(initialWelcome.authorName || "");
  const [authorIconUrl, setAuthorIconUrl] = useState(
    initialWelcome.authorIconUrl || ""
  );
  const [thumbnailUrl, setThumbnailUrl] = useState(
    initialWelcome.thumbnailUrl || ""
  );
  const [imageUrl, setImageUrl] = useState(initialWelcome.imageUrl || "");
  const [footerText, setFooterText] = useState(initialWelcome.footerText || "");
  const [meta, setMeta] = useState({ channels: [], roles: [] });
  const [usersById, setUsersById] = useState({});

  function collectUserMentionIds(text) {
    const ids = new Set();
    const value = String(text ?? "");
    for (const m of value.matchAll(/<@!?(?<id>\d+)>/g)) {
      if (m?.groups?.id) ids.add(m.groups.id);
    }
    return ids;
  }

  async function hydrateMentionUsers(ids) {
    const missing = [...ids].filter((id) => !usersById[String(id)]);
    if (!missing.length) return;
    try {
      const qs = encodeURIComponent(missing.join(","));
      const res = await fetch(`/api/discord/users?ids=${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.usersById) return;
      setUsersById((prev) => ({ ...prev, ...data.usersById }));
    } catch {}
  }

  useEffect(() => {
    const ids = new Set();
    for (const id of collectUserMentionIds(authorName)) ids.add(id);
    for (const id of collectUserMentionIds(title)) ids.add(id);
    for (const id of collectUserMentionIds(description)) ids.add(id);
    for (const id of collectUserMentionIds(footerText)) ids.add(id);
    hydrateMentionUsers(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorName, title, description, footerText]);
  const [metaError, setMetaError] = useState("");

  useEffect(() => {
    let active = true;
    setMetaError("");

    fetch(`/api/guild/${guildId}/meta`)
      .then((res) => {
        if (!res.ok) throw new Error("Falha ao carregar metadados");
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        setMeta({ channels: data.channels || [], roles: data.roles || [] });
      })
      .catch((error) => {
        if (!active) return;
        console.error(error);
        setMetaError("Nao foi possivel carregar canais do Discord.");
      });

    return () => {
      active = false;
    };
  }, [guildId]);

  const textChannels = useMemo(
    () =>
      meta.channels
        .filter((channel) =>
          [CHANNEL_TYPES.GUILD_TEXT, CHANNEL_TYPES.GUILD_ANNOUNCEMENT].includes(
            channel.type
          )
        )
        .sort((a, b) => a.position - b.position),
    [meta.channels]
  );

  const categoryChannels = useMemo(
    () =>
      meta.channels
        .filter((channel) => channel.type === CHANNEL_TYPES.GUILD_CATEGORY)
        .sort((a, b) => a.position - b.position),
    [meta.channels]
  );

  const groupedTextChannels = useMemo(() => {
    const categoryMap = new Map(
      categoryChannels.map((category, index) => [
        category.id,
        { name: category.name, order: index }
      ])
    );

    const groups = new Map();
    for (const channel of textChannels) {
      const parent = channel.parent_id;
      const categoryInfo = parent ? categoryMap.get(parent) : null;
      const label = categoryInfo?.name || "Sem categoria";
      if (!groups.has(label)) {
        groups.set(label, {
          label,
          order: categoryInfo?.order ?? 999,
          channels: []
        });
      }
      groups.get(label).channels.push(channel);
    }

    return Array.from(groups.values()).sort((a, b) => a.order - b.order);
  }, [textChannels, categoryChannels]);

  const selectableRoles = useMemo(() => {
    const roles = Array.isArray(meta.roles) ? meta.roles : [];
    return roles
      .filter((role) => role && role.id && role.name && role.name !== "@everyone")
      .filter((role) => !role.managed)
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  }, [meta.roles]);

  const filteredRoles = useMemo(() => {
    const term = roleSearch.trim().toLowerCase();
    if (!term) return selectableRoles;
    return selectableRoles.filter((role) =>
      String(role.name ?? "").toLowerCase().includes(term)
    );
  }, [roleSearch, selectableRoles]);

  function toggleRole(roleId) {
    const id = String(roleId ?? "");
    if (!id) return;
    setAutoRoleIds((prev) => {
      const set = new Set(prev.map((x) => String(x)));
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return [...set];
    });
  }

  const selectedRoleNames = useMemo(() => {
    if (!autoRoleIds.length) return [];
    const byId = new Map(selectableRoles.map((r) => [String(r.id), r]));
    return autoRoleIds
      .map((id) => byId.get(String(id))?.name)
      .filter(Boolean);
  }, [autoRoleIds, selectableRoles]);

  const filteredChannelGroups = useMemo(() => {
    const term = channelSearch.trim().toLowerCase();
    if (!term) return groupedTextChannels;
    return groupedTextChannels
      .map((group) => ({
        ...group,
        channels: group.channels.filter((channel) =>
          channel.name?.toLowerCase().includes(term)
        )
      }))
      .filter((group) => group.channels.length);
  }, [groupedTextChannels, channelSearch]);

  function handleColorInput(value) {
    const cleaned = String(value || "").trim();
    setColorText(cleaned);
    const hex = cleaned.replace("#", "");
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      setColor(`#${hex}`);
    }
  }

  function formatMarkdown(value) {
    const channelsById = Object.fromEntries(
      (meta.channels || []).map((c) => [String(c.id), c])
    );

    return renderDiscordMarkdownWithContext(value, {
      channelsById,
      usersById
    });
  }

  return (
    <div className="grid">
      <div className="card hero">
        <div>
          <h1>Bem-vindo</h1>
          <p className="helper">
            Configure o embed de boas-vindas e escolha o canal.
          </p>
        </div>
        <div className="badge">Guild {guildId}</div>
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

      {metaError ? <div className="notice error">{metaError}</div> : null}

      <div className="card">
        <form
          className="form"
          method="post"
          action={`/api/guild/${guildId}/welcome`}
        >
          <div className="field">
            <label className="toggle-row">
              <input
                type="checkbox"
                name="enabled"
                value="true"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <span>Ativar boas-vindas</span>
            </label>
          </div>

          <div className="field">
            <label>Canal de boas-vindas</label>
            <input
              className="search"
              type="search"
              placeholder="Buscar canal..."
              value={channelSearch}
              onChange={(event) => setChannelSearch(event.target.value)}
            />
            <select
              name="channelId"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
            >
              <option value="">(não definido)</option>
              {filteredChannelGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      #{channel.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Cargos automaticos (opcional)</label>
            <div className="helper">
              O bot adiciona estes cargos quando o membro entra. Garanta que o bot tenha permissao e que os cargos estejam abaixo do cargo do bot.
            </div>
            {autoRoleIds.map((id) => (
              <input key={id} type="hidden" name="autoRoleIds" value={id} />
            ))}

            <div className="ms">
              <div className="ms__toolbar">
                <input
                  className="ms__search"
                  value={roleSearch}
                  onChange={(e) => setRoleSearch(e.target.value)}
                  placeholder="Buscar cargos..."
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="button button--sm button--secondary"
                  onClick={() => setAutoRoleIds([])}
                  disabled={!autoRoleIds.length}
                  title="Nenhum cargo"
                >
                  Nenhum cargo
                </button>
              </div>

              <div className="ms__list" role="listbox" aria-label="Cargos automáticos">
                <button
                  type="button"
                  className={`ms__row ${autoRoleIds.length ? "" : "ms__row--active"}`}
                  onClick={() => setAutoRoleIds([])}
                >
                  <span className="ms__check" aria-hidden="true">
                    {autoRoleIds.length ? "" : "✓"}
                  </span>
                  <span className="ms__label">Nenhum cargo</span>
                  <span className="ms__meta">desativado</span>
                </button>

                {filteredRoles.map((role) => {
                  const id = String(role.id);
                  const active = autoRoleIds.includes(id);
                  const color = Number(role.color ?? 0);
                  const hex = color ? `#${color.toString(16).padStart(6, "0")}` : null;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`ms__row ${active ? "ms__row--active" : ""}`}
                      onClick={() => toggleRole(id)}
                    >
                      <span className="ms__check" aria-hidden="true">
                        {active ? "✓" : ""}
                      </span>
                      <span
                        className="ms__dot"
                        aria-hidden="true"
                        style={hex ? { background: hex } : undefined}
                      />
                      <span className="ms__label">@{role.name}</span>
                    </button>
                  );
                })}
              </div>

              {autoRoleIds.length ? (
                <div className="ms__chips" aria-label="Cargos selecionados">
                  {autoRoleIds
                    .map((id) => ({
                      id,
                      name: selectableRoles.find((r) => String(r.id) === String(id))?.name
                    }))
                    .filter((x) => x.name)
                    .map((role) => (
                      <button
                        key={role.id}
                        type="button"
                        className="chip"
                        onClick={() => toggleRole(role.id)}
                        title="Clique para remover"
                      >
                        @{role.name}
                        <span className="chip__x" aria-hidden="true">
                          ×
                        </span>
                      </button>
                    ))}
                </div>
              ) : (
                <div className="notice compact">Nenhum cargo será aplicado.</div>
              )}
            </div>
          </div>

          <div className="field">
            <label>Titulo</label>
            <input
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="field">
            <label>Mensagem</label>
            <textarea
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="field">
            <label>Cor do embed</label>
            <div className="color-row">
              <input
                type="color"
                value={color}
                onChange={(event) => {
                  setColor(event.target.value);
                  setColorText(event.target.value);
                }}
              />
              <input
                name="color"
                value={colorText}
                onChange={(event) => handleColorInput(event.target.value)}
                placeholder="#2fffe0"
              />
            </div>
          </div>

          <div className="field">
            <label>Autor (opcional)</label>
            <div className="form-row">
              <input
                name="authorName"
                value={authorName}
                onChange={(event) => setAuthorName(event.target.value)}
                placeholder="Nome do autor"
              />
              <input
                name="authorIconUrl"
                value={authorIconUrl}
                onChange={(event) => setAuthorIconUrl(event.target.value)}
                placeholder="URL do icone"
              />
            </div>
          </div>

          <div className="field">
            <label>Midia</label>
            <div className="form-row">
              <input
                name="thumbnailUrl"
                value={thumbnailUrl}
                onChange={(event) => setThumbnailUrl(event.target.value)}
                placeholder="Thumbnail URL"
              />
              <input
                name="imageUrl"
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="Imagem URL"
              />
            </div>
          </div>

          <div className="field">
            <label>Rodape (opcional)</label>
            <input
              name="footerText"
              value={footerText}
              onChange={(event) => setFooterText(event.target.value)}
              placeholder="Texto do rodape"
            />
          </div>

          <div className="notice compact">
            <strong>Variaveis disponiveis</strong>
            <div className="helper">
              {`{user}`} {`{username}`} {`{userTag}`} {`{server}`}{" "}
              {`{memberCount}`} {`{date}`}
            </div>
            <div className="helper">
              Markdown do Discord funciona aqui: **negrito**, *italico*, __sublinhado__,
              ~~riscado~~, `codigo`
            </div>
          </div>

          <button className="button" type="submit">
            Salvar boas-vindas
          </button>
        </form>

        <div className="preview">
          <div className="preview-label">Preview do embed</div>
          <div className="embed-preview" style={{ borderLeftColor: color }}>
            {authorName ? (
              <div className="embed-author">
                {authorIconUrl ? (
                  <img src={authorIconUrl} alt={authorName} />
                ) : null}
                <span dangerouslySetInnerHTML={{ __html: formatMarkdown(authorName) }} />
              </div>
            ) : null}
            {title ? (
              <div
                className="embed-title"
                dangerouslySetInnerHTML={{ __html: formatMarkdown(title) }}
              />
            ) : null}
            {description ? (
              <div
                className="embed-description"
                dangerouslySetInnerHTML={{ __html: formatMarkdown(description) }}
              />
            ) : null}
            {thumbnailUrl ? (
              <div className="embed-thumb">
                <img src={thumbnailUrl} alt="thumb" />
              </div>
            ) : null}
            {imageUrl ? (
              <div className="embed-image">
                <img src={imageUrl} alt="imagem" />
              </div>
            ) : null}
            {footerText ? (
              <div
                className="embed-footer"
                dangerouslySetInnerHTML={{ __html: formatMarkdown(footerText) }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
