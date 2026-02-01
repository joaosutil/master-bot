"use client";

import { useEffect, useMemo, useState } from "react";

const CHANNEL_TYPES = {
  GUILD_TEXT: 0,
  GUILD_ANNOUNCEMENT: 5,
  GUILD_CATEGORY: 4
};

function cn(...values) {
  return values.filter(Boolean).join(" ");
}

function filterGroups(groups, term) {
  const t = String(term ?? "").trim().toLowerCase();
  if (!t) return groups;
  return groups
    .map((g) => ({
      ...g,
      channels: g.channels.filter((c) => String(c.name ?? "").toLowerCase().includes(t))
    }))
    .filter((g) => g.channels.length);
}

export default function VerificationConfigClient({ guildId, initialVerification, notices = [] }) {
  const [enabled, setEnabled] = useState(Boolean(initialVerification.enabled));
  const [channelId, setChannelId] = useState(initialVerification.channelId || "");
  const [channelSearch, setChannelSearch] = useState("");
  const [roleId, setRoleId] = useState(initialVerification.roleId || "");
  const [removeRoleId, setRemoveRoleId] = useState(initialVerification.removeRoleId || "");
  const [roleSearch, setRoleSearch] = useState("");
  const [panelChannelId, setPanelChannelId] = useState(initialVerification.channelId || "");
  const normalizedInitialColor = String(initialVerification.panel?.color || "#2fffe0").startsWith("#")
    ? (initialVerification.panel?.color || "#2fffe0")
    : `#${initialVerification.panel?.color || "2fffe0"}`;
  const [panelTitle, setPanelTitle] = useState(initialVerification.panel?.title || "✅ Verificação");
  const [panelDescription, setPanelDescription] = useState(
    initialVerification.panel?.description ||
      "Clique no botão abaixo para se verificar e liberar o servidor."
  );
  const [panelButtonLabel, setPanelButtonLabel] = useState(
    initialVerification.panel?.buttonLabel || "Verificar"
  );
  const [panelFooterText, setPanelFooterText] = useState(
    initialVerification.panel?.footerText || "Master Bot • Verificação rápida"
  );
  const [panelColor, setPanelColor] = useState(normalizedInitialColor);
  const [panelColorText, setPanelColorText] = useState(normalizedInitialColor);
  const [captchaDifficulty, setCaptchaDifficulty] = useState(
    initialVerification.captcha?.difficulty || "medium"
  );
  const [meta, setMeta] = useState({ channels: [], roles: [] });
  const [metaError, setMetaError] = useState("");

  function handleColorInput(value) {
    const cleaned = String(value || "").trim();
    setPanelColorText(cleaned);
    const hex = cleaned.replace("#", "");
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      setPanelColor(`#${hex}`);
    }
  }

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
        setMetaError("Não foi possível carregar canais/cargos do Discord.");
      });

    return () => {
      active = false;
    };
  }, [guildId]);

  const textChannels = useMemo(
    () =>
      meta.channels
        .filter((channel) =>
          [CHANNEL_TYPES.GUILD_TEXT, CHANNEL_TYPES.GUILD_ANNOUNCEMENT].includes(channel.type)
        )
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [meta.channels]
  );

  const categoryChannels = useMemo(
    () =>
      meta.channels
        .filter((channel) => channel.type === CHANNEL_TYPES.GUILD_CATEGORY)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
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

  const channelGroups = useMemo(
    () => filterGroups(groupedTextChannels, channelSearch),
    [groupedTextChannels, channelSearch]
  );

  const roles = useMemo(() => {
    const list = Array.isArray(meta.roles) ? meta.roles : [];
    const term = roleSearch.trim().toLowerCase();
    const filtered = list
      .filter((r) => r && r.id && r.name && r.name !== "@everyone")
      .filter((r) => !r.managed);
    const sorted = filtered.sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
    if (!term) return sorted;
    return sorted.filter((r) => String(r.name ?? "").toLowerCase().includes(term));
  }, [meta.roles, roleSearch]);

  const currentMessageId = initialVerification.messageId || "";

  return (
    <div className="grid">
      <div className="card hero">
        <div>
          <h1>Verificação</h1>
          <p className="helper">
            Mensagem fixa com botão. Ao clicar, o usuário recebe um captcha (ephemeral) com 4 opções.
          </p>
          <div className="hero-actions">
            {currentMessageId ? <span className="stat">Mensagem: {currentMessageId}</span> : null}
          </div>
        </div>
        <div className="badge">Guild {guildId}</div>
      </div>

      {notices.length ? (
        <div className="notice-stack">
          {notices.map((notice, index) => (
            <div key={index} className={cn("notice", notice.tone || "info")}>
              <strong>{notice.title}</strong>
              <span className="helper">{notice.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      {metaError ? <div className="notice error">{metaError}</div> : null}

      <div className="card">
        <h2>Configuração</h2>
        <form className="form" method="post" action={`/api/guild/${guildId}/verification`}>
          <div className="field">
            <label>Ativar verificação</label>
            <div className="toggle-row">
              <input
                type="checkbox"
                name="enabled"
                checked={enabled}
                onChange={(e) => setEnabled(Boolean(e.target.checked))}
              />
              <span>Habilita o sistema de captcha e aplicação do cargo.</span>
            </div>
          </div>

          <div className="field">
            <label>Texto do painel</label>
            <div className="form-row">
              <div className="field">
                <label>Título</label>
                <input
                  name="panelTitle"
                  value={panelTitle}
                  onChange={(e) => setPanelTitle(e.target.value)}
                  placeholder="✅ Verificação"
                />
              </div>
              <div className="field">
                <label>Texto do botão</label>
                <input
                  name="panelButtonLabel"
                  value={panelButtonLabel}
                  onChange={(e) => setPanelButtonLabel(e.target.value)}
                  placeholder="Verificar"
                />
              </div>
            </div>

            <div className="field">
              <label>Descrição</label>
              <textarea
                name="panelDescription"
                value={panelDescription}
                onChange={(e) => setPanelDescription(e.target.value)}
              />
            </div>

            <div className="form-row">
              <div className="field">
                <label>Cor do embed</label>
                <div className="color-row">
                  <input
                    type="color"
                    value={panelColor}
                    onChange={(event) => {
                      setPanelColor(event.target.value);
                      setPanelColorText(event.target.value);
                    }}
                  />
                  <input
                    name="panelColor"
                    value={panelColorText}
                    onChange={(event) => handleColorInput(event.target.value)}
                    placeholder="#2fffe0"
                  />
                </div>
              </div>
              <div className="field">
                <label>Rodapé</label>
                <input
                  name="panelFooterText"
                  value={panelFooterText}
                  onChange={(e) => setPanelFooterText(e.target.value)}
                  placeholder="Master Bot • Verificação rápida"
                />
              </div>
            </div>
          </div>

          <div className="field">
            <label>Dificuldade do captcha</label>
            <select
              name="captchaDifficulty"
              value={captchaDifficulty}
              onChange={(e) => setCaptchaDifficulty(e.target.value)}
            >
              <option value="easy">Fácil (4 caracteres, pouca distorção)</option>
              <option value="medium">Média (5 caracteres)</option>
              <option value="hard">Difícil (6 caracteres, mais ruído e opções parecidas)</option>
            </select>
            <p className="helper">
              Dica: no difícil, as opções erradas ficam mais parecidas com a correta.
            </p>
          </div>

          <div className="field">
            <label>Canal do painel</label>
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
              onChange={(e) => {
                setChannelId(e.target.value);
                setPanelChannelId(e.target.value);
              }}
            >
              <option value="">(nenhum)</option>
              {channelGroups.map((group) => (
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
            <label>Cargo de verificado</label>
            <input
              className="search"
              type="search"
              placeholder="Buscar cargo..."
              value={roleSearch}
              onChange={(event) => setRoleSearch(event.target.value)}
            />
            <select
              name="roleId"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            >
              <option value="">(nenhum)</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  @{role.name}
                </option>
              ))}
            </select>
            <p className="helper">
              O bot precisa de Manage Roles e o cargo deve estar abaixo do cargo do bot.
            </p>
          </div>

          <div className="field">
            <label>Cargo para remover (opcional)</label>
            <select
              name="removeRoleId"
              value={removeRoleId}
              onChange={(e) => setRemoveRoleId(e.target.value)}
            >
              <option value="">(nenhum)</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  @{role.name}
                </option>
              ))}
            </select>
            <p className="helper">
              Útil para remover um cargo tipo “Não verificado” ao concluir.
            </p>
          </div>

          <button className="button" type="submit">
            Salvar verificação
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Publicar mensagem</h2>
        <form className="form" method="post" action={`/api/guild/${guildId}/verification/panel`}>
          <div className="field">
            <label>Canal</label>
            <select
              name="channelId"
              value={panelChannelId}
              onChange={(e) => setPanelChannelId(e.target.value)}
            >
              <option value="">(nenhum)</option>
              {groupedTextChannels.map((group) => (
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
            <label>Fixar mensagem</label>
            <select name="pinned" defaultValue="true">
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </select>
          </div>

          <button className="button" type="submit" disabled={!roleId || !panelChannelId}>
            Publicar / Atualizar painel
          </button>
          <p className="helper">
            Publicar usa o token do bot para criar/editar a mensagem com botão.
          </p>
        </form>
      </div>
    </div>
  );
}
