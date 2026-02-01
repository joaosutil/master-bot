"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { renderDiscordMarkdownWithContext } from "../../../../lib/discordMarkdown.js";

const CHANNEL_TYPES = {
  GUILD_TEXT: 0,
  GUILD_ANNOUNCEMENT: 5,
  GUILD_CATEGORY: 4
};

export default function TicketConfigClient({
  guildId,
  initialTicket,
  initialPanel,
  notices = [],
  movedCount = 0
}) {
  const formRef = useRef(null);
  const panelFormRef = useRef(null);
  const [ticketType, setTicketType] = useState(initialTicket.type || "thread");
  const [openChannelId, setOpenChannelId] = useState(initialTicket.openChannelId || "");
  const initialAutoClose = initialTicket.autoClose ?? {};
  const [autoCloseEnabled, setAutoCloseEnabled] = useState(
    Boolean(initialAutoClose.enabled)
  );
  const [autoCloseAfterMinutes, setAutoCloseAfterMinutes] = useState(
    Number(initialAutoClose.afterMinutes ?? 0)
  );
  const [autoCloseReminderMinutes, setAutoCloseReminderMinutes] = useState(
    Number(initialAutoClose.reminderMinutes ?? 0)
  );
  const [openChannelSearch, setOpenChannelSearch] = useState("");
  const [panelChannelId, setPanelChannelId] = useState(
    initialPanel.panelChannelId || ""
  );
  const [panelChannelSearch, setPanelChannelSearch] = useState("");
  const [staffRoleIds, setStaffRoleIds] = useState(initialTicket.staffRoleIds || []);
  const [formResponseTemplate, setFormResponseTemplate] = useState(
    initialTicket.formResponseTemplate || ""
  );
  const initialCategories = (initialTicket.categories?.length
    ? initialTicket.categories
    : [
        {
          label: "Geral",
          description: "Suporte geral",
          template: "",
          questions: []
        }
      ]).map((category) => ({
    label: category.label ?? "",
    description: category.description ?? "",
    template: category.template ?? "",
    questions: Array.isArray(category.questions)
      ? category.questions.join("\n")
      : ""
  }));
  const [categories, setCategories] = useState(initialCategories);
  const [roleSearch, setRoleSearch] = useState("");
  const normalizedInitialColor = (initialPanel.panelColor || "#2fffe0").startsWith("#")
    ? initialPanel.panelColor || "#2fffe0"
    : `#${initialPanel.panelColor}`;
  const [panelColor, setPanelColor] = useState(normalizedInitialColor);
  const [panelColorText, setPanelColorText] = useState(normalizedInitialColor);
  const [panelTitle, setPanelTitle] = useState(
    initialPanel.panelTitle || "Abrir ticket"
  );
  const [panelDescription, setPanelDescription] = useState(
    initialPanel.panelDescription || "Selecione a categoria abaixo."
  );
  const [panelAuthorName, setPanelAuthorName] = useState(
    initialPanel.panelAuthorName || ""
  );
  const [panelAuthorIconUrl, setPanelAuthorIconUrl] = useState(
    initialPanel.panelAuthorIconUrl || ""
  );
  const [panelThumbnailUrl, setPanelThumbnailUrl] = useState(
    initialPanel.panelThumbnailUrl || ""
  );
  const [panelImageUrl, setPanelImageUrl] = useState(
    initialPanel.panelImageUrl || ""
  );
  const [panelFooterText, setPanelFooterText] = useState(
    initialPanel.panelFooterText || ""
  );
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
    for (const id of collectUserMentionIds(panelAuthorName)) ids.add(id);
    for (const id of collectUserMentionIds(panelTitle)) ids.add(id);
    for (const id of collectUserMentionIds(panelDescription)) ids.add(id);
    for (const id of collectUserMentionIds(panelFooterText)) ids.add(id);
    for (const id of collectUserMentionIds(formResponseTemplate)) ids.add(id);
    hydrateMentionUsers(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelAuthorName, panelTitle, panelDescription, panelFooterText, formResponseTemplate]);
  const [metaError, setMetaError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

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
        setMetaError("Nao foi possivel carregar canais/cargos do Discord.");
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

  function filterGroups(groups, query) {
    const term = query.trim().toLowerCase();
    if (!term) return groups;
    return groups
      .map((group) => ({
        ...group,
        channels: group.channels.filter((channel) =>
          channel.name?.toLowerCase().includes(term)
        )
      }))
      .filter((group) => group.channels.length);
  }

  const openChannelGroups = useMemo(
    () => filterGroups(groupedTextChannels, openChannelSearch),
    [groupedTextChannels, openChannelSearch]
  );

  const panelChannelGroups = useMemo(
    () => filterGroups(groupedTextChannels, panelChannelSearch),
    [groupedTextChannels, panelChannelSearch]
  );

  const roleOptions = useMemo(
    () =>
      meta.roles
        .filter((role) => role.name !== "@everyone")
        .sort((a, b) => b.position - a.position),
    [meta.roles]
  );

  const filteredRoles = useMemo(() => {
    const query = roleSearch.trim().toLowerCase();
    if (!query) return roleOptions;
    return roleOptions.filter((role) => role.name.toLowerCase().includes(query));
  }, [roleOptions, roleSearch]);

  function toggleRole(roleId) {
    setStaffRoleIds((current) =>
      current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId]
    );
  }

  function selectAllRoles() {
    setStaffRoleIds(filteredRoles.map((role) => role.id));
  }

  function clearRoles() {
    setStaffRoleIds([]);
  }

  function updateCategory(index, field, value) {
    setCategories((current) => {
      const next = [...current];
      const target = next[index] ?? {
        label: "",
        description: "",
        template: "",
        questions: ""
      };
      next[index] = { ...target, [field]: value };
      return next;
    });
  }

  function addCategory() {
    setCategories((current) => [
      ...current,
      { label: "", description: "", template: "", questions: "" }
    ]);
  }

  function removeCategory(index) {
    setCategories((current) => current.filter((_, idx) => idx !== index));
  }

  const categoriesPayload = useMemo(() => {
    const normalized = categories
      .map((category) => ({
        label: String(category.label ?? "").trim(),
        description: String(category.description ?? "").trim(),
        template: String(category.template ?? "").trim(),
        questions: String(category.questions ?? "")
          .split(/\r?\n/)
          .map((question) => question.trim())
          .filter(Boolean)
          .slice(0, 5)
      }))
      .filter((category) => category.label.length)
      .slice(0, 25)
      .map((category) => ({
        label: category.label,
        description: category.description || undefined,
        template: category.template || undefined,
        questions: category.questions?.length ? category.questions : undefined
      }));
    return JSON.stringify(normalized);
  }, [categories]);

  const categoryCount = useMemo(
    () => categories.filter((category) => String(category.label ?? "").trim()).length,
    [categories]
  );
  const canAddCategory = categories.length < 25;

  function handleColorInput(value) {
    const cleaned = String(value || "").trim();
    setPanelColorText(cleaned);
    const hex = cleaned.replace("#", "");
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      setPanelColor(`#${hex}`);
    }
  }

  function formatMarkdown(value) {
    const channelsById = Object.fromEntries(
      (meta.channels || []).map((c) => [String(c.id), c])
    );
    const rolesById = Object.fromEntries(
      (meta.roles || []).map((r) => [String(r.id), r])
    );

    return renderDiscordMarkdownWithContext(value, {
      channelsById,
      rolesById,
      usersById
    });
  }

  function resetFields() {
    setTicketType(initialTicket.type || "thread");
    setOpenChannelId(initialTicket.openChannelId || "");
    const nextAutoClose = initialTicket.autoClose ?? {};
    setAutoCloseEnabled(Boolean(nextAutoClose.enabled));
    setAutoCloseAfterMinutes(Number(nextAutoClose.afterMinutes ?? 0));
    setAutoCloseReminderMinutes(Number(nextAutoClose.reminderMinutes ?? 0));
    setOpenChannelSearch("");
    setPanelChannelId(initialPanel.panelChannelId || "");
    setPanelChannelSearch("");
    setStaffRoleIds(initialTicket.staffRoleIds || []);
    setFormResponseTemplate(initialTicket.formResponseTemplate || "");
    setCategories(initialCategories);
    setRoleSearch("");
    const defaultColor = (initialPanel.panelColor || "#2fffe0").startsWith("#")
      ? initialPanel.panelColor || "#2fffe0"
      : `#${initialPanel.panelColor}`;
    setPanelColor(defaultColor);
    setPanelColorText(defaultColor);
    setPanelTitle(initialPanel.panelTitle || "Abrir ticket");
    setPanelDescription(
      initialPanel.panelDescription || "Selecione a categoria abaixo."
    );
    setPanelAuthorName(initialPanel.panelAuthorName || "");
    setPanelAuthorIconUrl(initialPanel.panelAuthorIconUrl || "");
    setPanelThumbnailUrl(initialPanel.panelThumbnailUrl || "");
    setPanelImageUrl(initialPanel.panelImageUrl || "");
    setPanelFooterText(initialPanel.panelFooterText || "");
    setCopyStatus("Campos resetados.");
    setTimeout(() => setCopyStatus(""), 2400);
  }

  async function copyConfig() {
    if (!formRef.current || !panelFormRef.current) return;
    const ticketData = new FormData(formRef.current);
    const panelData = new FormData(panelFormRef.current);

    let parsedCategories = [];
    try {
      parsedCategories = JSON.parse(categoriesPayload);
    } catch (error) {
      console.warn("Falha ao serializar categorias:", error);
    }

    const ticketPayload = {
      type: ticketData.get("type") || ticketType,
      openChannelId: ticketData.get("openChannelId") || openChannelId,
      autoClose: {
        enabled: autoCloseEnabled || ticketData.get("autoCloseEnabled") != null,
        afterMinutes: Number(
          ticketData.get("autoCloseAfterMinutes") || autoCloseAfterMinutes || 0
        ),
        reminderMinutes: Number(
          ticketData.get("autoCloseReminderMinutes") || autoCloseReminderMinutes || 0
        )
      },
      staffRoleIds: ticketData.getAll("staffRoleIds"),
      formResponseTemplate:
        ticketData.get("formResponseTemplate") || formResponseTemplate,
      categories: parsedCategories
    };

    const panelPayload = {
      panelChannelId: panelData.get("panelChannelId") || panelChannelId,
      panelTitle: panelData.get("panelTitle") || panelTitle,
      panelDescription: panelData.get("panelDescription") || panelDescription,
      panelColor: panelData.get("panelColor") || panelColorText,
      panelAuthorName: panelData.get("panelAuthorName") || panelAuthorName,
      panelAuthorIconUrl:
        panelData.get("panelAuthorIconUrl") || panelAuthorIconUrl,
      panelThumbnailUrl:
        panelData.get("panelThumbnailUrl") || panelThumbnailUrl,
      panelImageUrl: panelData.get("panelImageUrl") || panelImageUrl,
      panelFooterText: panelData.get("panelFooterText") || panelFooterText,
      panelPinned: panelData.get("panelPinned") === "true"
    };

    const payload = {
      ticket: ticketPayload,
      panel: panelPayload
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopyStatus("Configuração copiada.");
    } catch (error) {
      console.error(error);
      setCopyStatus("Nao foi possivel copiar.");
    } finally {
      setTimeout(() => setCopyStatus(""), 2400);
    }
  }

  return (
    <div className="grid">
        <div className="card hero">
          <div>
            <h1>Painel de Tickets</h1>
            <p className="helper">
              Configure categorias, cargos e o painel público. Tudo direto dos dados
              do servidor.
            </p>
            <div className="hero-actions">
              <a className="ghost-button" href={`/guild/${guildId}/tickets/queue`}>
                Fila de tickets
              </a>
              <button className="ghost-button" type="button" onClick={copyConfig}>
                Copiar configuracao
              </button>
              <button className="ghost-button" type="button" onClick={resetFields}>
                Resetar campos
              </button>
            {copyStatus ? <span className="helper">{copyStatus}</span> : null}
          </div>
        </div>
        <div className="hero-meta">
          {movedCount ? <div className="stat">Movidos: {movedCount}</div> : null}
          <div className="badge">Guild {guildId}</div>
        </div>
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
        <h2>Configuração</h2>
        <form
          ref={formRef}
          className="form"
          method="post"
          action={`/api/guild/${guildId}/tickets`}
        >
          <div className="field">
            <label>Tipo</label>
            <select
              name="type"
              value={ticketType}
              onChange={(event) => setTicketType(event.target.value)}
            >
              <option value="thread">Thread</option>
              <option value="channel">Canal privado</option>
            </select>
            {ticketType === "channel" ? (
              <p className="helper">
                Para tipo canal, o bot cria categorias automaticas: tickets-&lt;categoria&gt;.
              </p>
            ) : (
              <p className="helper">
                Threads herdam as permissoes do canal de abertura.
              </p>
            )}
          </div>

          <div className="field">
            <label>Canal de abertura</label>
            <input
              className="search"
              type="search"
              placeholder="Buscar canal..."
              value={openChannelSearch}
              onChange={(event) => setOpenChannelSearch(event.target.value)}
            />
            <select
              name="openChannelId"
              value={openChannelId}
              onChange={(event) => setOpenChannelId(event.target.value)}
            >
              <option value="">(não definido)</option>
              {openChannelGroups.map((group) => (
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
            <label>Auto-close por inatividade</label>
            <div className="toggle-row">
              <input
                type="checkbox"
                name="autoCloseEnabled"
                checked={autoCloseEnabled}
                onChange={(e) => {
                  const enabled = Boolean(e.target.checked);
                  setAutoCloseEnabled(enabled);
                  if (!enabled) {
                    setAutoCloseAfterMinutes(0);
                    setAutoCloseReminderMinutes(0);
                  } else if (!autoCloseAfterMinutes) {
                    setAutoCloseAfterMinutes(1440);
                    setAutoCloseReminderMinutes(120);
                  }
                }}
              />
              <span>Fechar tickets automaticamente quando ficarem parados.</span>
            </div>

            <div className="form-row">
              <div className="field">
                <label>Fechar apos</label>
                <select
                  name="autoCloseAfterMinutes"
                  value={String(autoCloseAfterMinutes || 0)}
                  onChange={(e) => {
                    const v = Number(e.target.value || 0);
                    setAutoCloseAfterMinutes(v);
                    if (autoCloseReminderMinutes && v && autoCloseReminderMinutes >= v) {
                      setAutoCloseReminderMinutes(0);
                    }
                  }}
                  disabled={!autoCloseEnabled}
                >
                  <option value="0">Nenhum</option>
                  <option value="60">1 hora</option>
                  <option value="180">3 horas</option>
                  <option value="360">6 horas</option>
                  <option value="720">12 horas</option>
                  <option value="1440">24 horas</option>
                  <option value="2880">2 dias</option>
                  <option value="4320">3 dias</option>
                  <option value="10080">7 dias</option>
                </select>
              </div>

              <div className="field">
                <label>Lembrete (antes)</label>
                <select
                  name="autoCloseReminderMinutes"
                  value={String(autoCloseReminderMinutes || 0)}
                  onChange={(e) => setAutoCloseReminderMinutes(Number(e.target.value || 0))}
                  disabled={!autoCloseEnabled || !autoCloseAfterMinutes}
                >
                  <option value="0">Nenhum</option>
                  <option value="30">30 min</option>
                  <option value="60">1 hora</option>
                  <option value="120">2 horas</option>
                  <option value="360">6 horas</option>
                </select>
              </div>
            </div>

            <p className="helper">
              Dica: o lembrete precisa ser menor que o tempo de fechamento. Enviar mensagem no ticket reseta o timer.
            </p>
          </div>

          <div className="field">
            <label>Cargos staff</label>
            <input
              className="search"
              type="search"
              placeholder="Buscar cargo..."
              value={roleSearch}
              onChange={(event) => setRoleSearch(event.target.value)}
            />
            <div className="role-toolbar">
              <span className="helper">Selecionados: {staffRoleIds.length}</span>
              <div className="role-actions">
                <button className="ghost-button" type="button" onClick={selectAllRoles}>
                  Selecionar todos
                </button>
                <button className="ghost-button" type="button" onClick={clearRoles}>
                  Limpar
                </button>
              </div>
            </div>
            <div className="checkbox-grid">
              {filteredRoles.map((role) => {
                const checked = staffRoleIds.includes(role.id);
                return (
                  <label
                    key={role.id}
                    className={`checkbox-item ${checked ? "checked" : ""}`}
                  >
                    <input
                      type="checkbox"
                      name="staffRoleIds"
                      value={role.id}
                      checked={checked}
                      onChange={() => toggleRole(role.id)}
                    />
                    <span>{role.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="field">
            <label>Mensagem das respostas do formulario</label>
            <textarea
              name="formResponseTemplate"
              value={formResponseTemplate}
              onChange={(event) => setFormResponseTemplate(event.target.value)}
              placeholder="Duvida do usuario: {answers}"
            />
            <p className="helper">
              Variaveis: {`{answers}`}, {`{user}`}, {`{username}`}, {`{userTag}`},
              {`{category}`}, {`{server}`}
            </p>
          </div>

          <div className="field">
            <label>Categorias de ticket</label>
            <div className="category-toolbar">
              <span className="helper">
                {categoryCount} categoria(s) configurada(s)
              </span>
              <button
                className="ghost-button"
                type="button"
                onClick={addCategory}
                disabled={!canAddCategory}
              >
                Adicionar categoria
              </button>
            </div>
            <input type="hidden" name="categoriesJson" value={categoriesPayload} />
            <div className="category-list">
              {categories.map((category, index) => (
                <div className="category-card" key={`cat-${index}`}>
                <div className="category-row">
                  <input
                    value={category.label}
                    onChange={(event) =>
                      updateCategory(index, "label", event.target.value)
                    }
                    placeholder="Nome (ex: Geral)"
                  />
                  <input
                    value={category.description}
                    onChange={(event) =>
                      updateCategory(index, "description", event.target.value)
                    }
                    placeholder="Descricao curta"
                  />
                </div>
                <textarea
                  value={category.questions}
                  onChange={(event) =>
                    updateCategory(index, "questions", event.target.value)
                  }
                  placeholder="Perguntas do formulario (uma por linha, max 5)"
                />
                <textarea
                  value={category.template}
                  onChange={(event) =>
                    updateCategory(index, "template", event.target.value)
                  }
                    placeholder="Mensagem/template enviada ao abrir o ticket (opcional)"
                  />
                  <div className="category-actions">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => removeCategory(index)}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="helper">
              Variaveis: {`{user}`}, {`{username}`}, {`{userTag}`}, {`{category}`},
              {`{server}`} | Max 5 perguntas por categoria.
            </p>
          </div>

          <button className="button" type="submit">
            Salvar configuracao
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Painel público</h2>
        <form
          ref={panelFormRef}
          className="form"
          method="post"
          action={`/api/guild/${guildId}/tickets/panel`}
        >
          <div className="field">
            <label>Canal do painel</label>
            <input
              className="search"
              type="search"
              placeholder="Buscar canal..."
              value={panelChannelSearch}
              onChange={(event) => setPanelChannelSearch(event.target.value)}
            />
            <select
              name="panelChannelId"
              value={panelChannelId}
              onChange={(event) => setPanelChannelId(event.target.value)}
            >
              <option value="">(não definido)</option>
              {panelChannelGroups.map((group) => (
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
            <label>Titulo</label>
            <input
              name="panelTitle"
              value={panelTitle}
              onChange={(event) => setPanelTitle(event.target.value)}
            />
          </div>

          <div className="field">
            <label>Mensagem</label>
            <textarea
              name="panelDescription"
              value={panelDescription}
              onChange={(event) => setPanelDescription(event.target.value)}
            />
          </div>

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
            <label>Autor (opcional)</label>
            <div className="form-row">
              <input
                name="panelAuthorName"
                value={panelAuthorName}
                onChange={(event) => setPanelAuthorName(event.target.value)}
                placeholder="Nome do autor"
              />
              <input
                name="panelAuthorIconUrl"
                value={panelAuthorIconUrl}
                onChange={(event) => setPanelAuthorIconUrl(event.target.value)}
                placeholder="URL do icone"
              />
            </div>
          </div>

          <div className="field">
            <label>Midia</label>
            <div className="form-row">
              <input
                name="panelThumbnailUrl"
                value={panelThumbnailUrl}
                onChange={(event) => setPanelThumbnailUrl(event.target.value)}
                placeholder="Thumbnail URL"
              />
              <input
                name="panelImageUrl"
                value={panelImageUrl}
                onChange={(event) => setPanelImageUrl(event.target.value)}
                placeholder="Imagem URL"
              />
            </div>
          </div>

          <div className="field">
            <label>Rodape (opcional)</label>
            <input
              name="panelFooterText"
              value={panelFooterText}
              onChange={(event) => setPanelFooterText(event.target.value)}
              placeholder="Texto do rodape"
            />
          </div>

          <div className="field">
            <label>Fixar mensagem</label>
            <select name="panelPinned" defaultValue={initialPanel.panelPinned ? "true" : "false"}>
              <option value="false">Nao</option>
              <option value="true">Sim</option>
            </select>
          </div>

          <div className="notice compact">
            <strong>Variaveis disponiveis</strong>
            <div className="helper">
              {`{server}`} = nome do servidor - {`{serverId}`} - {`{date}`}
            </div>
            <div className="helper">
              Markdown do Discord funciona aqui: **negrito**, *italico*, __sublinhado__,
              ~~riscado~~, `codigo`
            </div>
          </div>

          <button className="button" type="submit">
            Publicar / Atualizar painel
          </button>
        </form>
        <div className="preview">
          <div className="preview-label">Preview do embed</div>
          <div className="embed-preview" style={{ borderLeftColor: panelColor }}>
            {panelAuthorName ? (
              <div className="embed-author">
                {panelAuthorIconUrl ? (
                  <img src={panelAuthorIconUrl} alt={panelAuthorName} />
                ) : null}
                <span dangerouslySetInnerHTML={{ __html: formatMarkdown(panelAuthorName) }} />
              </div>
            ) : null}
            {panelTitle ? (
              <div
                className="embed-title"
                dangerouslySetInnerHTML={{ __html: formatMarkdown(panelTitle) }}
              />
            ) : null}
            {panelDescription ? (
              <div
                className="embed-description"
                dangerouslySetInnerHTML={{ __html: formatMarkdown(panelDescription) }}
              />
            ) : null}
            {panelThumbnailUrl ? (
              <div className="embed-thumb">
                <img src={panelThumbnailUrl} alt="thumb" />
              </div>
            ) : null}
            {panelImageUrl ? (
              <div className="embed-image">
                <img src={panelImageUrl} alt="imagem" />
              </div>
            ) : null}
            {panelFooterText ? (
              <div
                className="embed-footer"
                dangerouslySetInnerHTML={{ __html: formatMarkdown(panelFooterText) }}
              />
            ) : null}
          </div>
        </div>
        <p className="helper">
          O painel usa o token do bot para enviar ou editar a mensagem no canal.
        </p>
      </div>
    </div>
  );
}
