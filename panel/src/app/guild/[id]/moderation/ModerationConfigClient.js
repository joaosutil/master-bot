"use client";

import { useEffect, useMemo, useState } from "react";

const CHANNEL_TYPES = {
  GUILD_TEXT: 0,
  GUILD_ANNOUNCEMENT: 5,
  GUILD_CATEGORY: 4
};

export default function ModerationConfigClient({
  guildId,
  initialModeration,
  notices = []
}) {
  const [meta, setMeta] = useState({ channels: [], roles: [] });
  const [metaError, setMetaError] = useState("");
  const [logChannelSearch, setLogChannelSearch] = useState("");
  const [logChannelId, setLogChannelId] = useState(
    initialModeration.logChannelId || ""
  );

  const [automodEnabled, setAutomodEnabled] = useState(
    initialModeration.automod.enabled ?? false
  );

  const [antiFloodEnabled, setAntiFloodEnabled] = useState(
    initialModeration.automod.antiFlood.enabled ?? false
  );
  const [antiFloodMaxMessages, setAntiFloodMaxMessages] = useState(
    initialModeration.automod.antiFlood.maxMessages ?? 6
  );
  const [antiFloodIntervalSeconds, setAntiFloodIntervalSeconds] = useState(
    initialModeration.automod.antiFlood.intervalSeconds ?? 8
  );
  const [antiFloodTimeoutMinutes, setAntiFloodTimeoutMinutes] = useState(
    initialModeration.automod.antiFlood.timeoutMinutes ?? 2
  );
  const [antiFloodDeleteMessages, setAntiFloodDeleteMessages] = useState(
    initialModeration.automod.antiFlood.deleteMessages ?? true
  );

  const [antiSpamEnabled, setAntiSpamEnabled] = useState(
    initialModeration.automod.antiSpam.enabled ?? false
  );
  const [antiSpamMaxDuplicates, setAntiSpamMaxDuplicates] = useState(
    initialModeration.automod.antiSpam.maxDuplicates ?? 3
  );
  const [antiSpamIntervalSeconds, setAntiSpamIntervalSeconds] = useState(
    initialModeration.automod.antiSpam.intervalSeconds ?? 10
  );
  const [antiSpamTimeoutMinutes, setAntiSpamTimeoutMinutes] = useState(
    initialModeration.automod.antiSpam.timeoutMinutes ?? 2
  );
  const [antiSpamDeleteMessages, setAntiSpamDeleteMessages] = useState(
    initialModeration.automod.antiSpam.deleteMessages ?? true
  );

  const [antiLinkEnabled, setAntiLinkEnabled] = useState(
    initialModeration.automod.antiLink.enabled ?? false
  );
  const [antiLinkAllowedRoleIds, setAntiLinkAllowedRoleIds] = useState(
    initialModeration.automod.antiLink.allowedRoleIds ?? []
  );
  const [antiLinkAllowedChannelIds, setAntiLinkAllowedChannelIds] = useState(
    initialModeration.automod.antiLink.allowedChannelIds ?? []
  );
  const [antiLinkTimeoutMinutes, setAntiLinkTimeoutMinutes] = useState(
    initialModeration.automod.antiLink.timeoutMinutes ?? 0
  );
  const [antiLinkDeleteMessages, setAntiLinkDeleteMessages] = useState(
    initialModeration.automod.antiLink.deleteMessages ?? true
  );

  const [wordFilterEnabled, setWordFilterEnabled] = useState(
    initialModeration.automod.wordFilter.enabled ?? false
  );
  const [wordFilterWords, setWordFilterWords] = useState(
    (initialModeration.automod.wordFilter.words ?? []).join("\n")
  );
  const [wordFilterTimeoutMinutes, setWordFilterTimeoutMinutes] = useState(
    initialModeration.automod.wordFilter.timeoutMinutes ?? 0
  );
  const [wordFilterDeleteMessages, setWordFilterDeleteMessages] = useState(
    initialModeration.automod.wordFilter.deleteMessages ?? true
  );

  const [raidEnabled, setRaidEnabled] = useState(
    initialModeration.automod.raidDetection.enabled ?? false
  );
  const [raidMaxJoins, setRaidMaxJoins] = useState(
    initialModeration.automod.raidDetection.maxJoins ?? 6
  );
  const [raidIntervalSeconds, setRaidIntervalSeconds] = useState(
    initialModeration.automod.raidDetection.intervalSeconds ?? 12
  );

  const [roleSearch, setRoleSearch] = useState("");
  const [channelSearch, setChannelSearch] = useState("");

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

  const logChannelGroups = useMemo(
    () => filterGroups(groupedTextChannels, logChannelSearch),
    [groupedTextChannels, logChannelSearch]
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

  const filteredChannels = useMemo(() => {
    const query = channelSearch.trim().toLowerCase();
    if (!query) return textChannels;
    return textChannels.filter((channel) =>
      channel.name?.toLowerCase().includes(query)
    );
  }, [textChannels, channelSearch]);

  function toggleRole(roleId) {
    setAntiLinkAllowedRoleIds((current) =>
      current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId]
    );
  }

  function toggleChannel(channelId) {
    setAntiLinkAllowedChannelIds((current) =>
      current.includes(channelId)
        ? current.filter((id) => id !== channelId)
        : [...current, channelId]
    );
  }

  function clearAllowedRoles() {
    setAntiLinkAllowedRoleIds([]);
  }

  function clearAllowedChannels() {
    setAntiLinkAllowedChannelIds([]);
  }

  return (
    <div className="grid">
      <div className="card hero">
        <div>
          <h1>Moderação & Automod</h1>
          <p className="helper">
            Configure logs, anti-flood, anti-spam, anti-link, filtro de palavras e
            alerta de raid.
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
        <h2>Configuração geral</h2>
        <form className="form" method="post" action={`/api/guild/${guildId}/moderation`}>
          <div className="field">
            <label>Canal de logs</label>
            <input
              className="search"
              type="search"
              placeholder="Buscar canal..."
              value={logChannelSearch}
              onChange={(event) => setLogChannelSearch(event.target.value)}
            />
            <select
              name="logChannelId"
              value={logChannelId}
              onChange={(event) => setLogChannelId(event.target.value)}
            >
              <option value="">(não definido)</option>
              {logChannelGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      #{channel.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="helper">Logs de moderacao e automod serao enviados aqui.</p>
          </div>

          <div className="field">
            <label>Automod geral</label>
            <label className="toggle-row">
              <input
                type="checkbox"
                name="automodEnabled"
                checked={automodEnabled}
                onChange={(event) => setAutomodEnabled(event.target.checked)}
              />
              <span>Ativar automod</span>
            </label>
          </div>

          <div className="field">
            <label>Anti-flood</label>
            <label className="toggle-row">
              <input
                type="checkbox"
                name="antiFloodEnabled"
                checked={antiFloodEnabled}
                onChange={(event) => setAntiFloodEnabled(event.target.checked)}
              />
              <span>Detectar excesso de mensagens por janela</span>
            </label>
            <div className="form-row">
              <input
                type="number"
                name="antiFloodMaxMessages"
                min="2"
                max="25"
                value={antiFloodMaxMessages}
                onChange={(event) => setAntiFloodMaxMessages(event.target.value)}
                placeholder="Max mensagens"
              />
              <input
                type="number"
                name="antiFloodIntervalSeconds"
                min="2"
                max="60"
                value={antiFloodIntervalSeconds}
                onChange={(event) => setAntiFloodIntervalSeconds(event.target.value)}
                placeholder="Janela (s)"
              />
              <input
                type="number"
                name="antiFloodTimeoutMinutes"
                min="0"
                max="10080"
                value={antiFloodTimeoutMinutes}
                onChange={(event) => setAntiFloodTimeoutMinutes(event.target.value)}
                placeholder="Timeout (min)"
              />
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                name="antiFloodDeleteMessages"
                checked={antiFloodDeleteMessages}
                onChange={(event) => setAntiFloodDeleteMessages(event.target.checked)}
              />
              <span>Remover mensagem detectada</span>
            </label>
          </div>

          <div className="field">
            <label>Anti-spam</label>
            <label className="toggle-row">
              <input
                type="checkbox"
                name="antiSpamEnabled"
                checked={antiSpamEnabled}
                onChange={(event) => setAntiSpamEnabled(event.target.checked)}
              />
              <span>Detectar mensagens repetidas</span>
            </label>
            <div className="form-row">
              <input
                type="number"
                name="antiSpamMaxDuplicates"
                min="2"
                max="15"
                value={antiSpamMaxDuplicates}
                onChange={(event) => setAntiSpamMaxDuplicates(event.target.value)}
                placeholder="Repeticoes"
              />
              <input
                type="number"
                name="antiSpamIntervalSeconds"
                min="3"
                max="60"
                value={antiSpamIntervalSeconds}
                onChange={(event) => setAntiSpamIntervalSeconds(event.target.value)}
                placeholder="Janela (s)"
              />
              <input
                type="number"
                name="antiSpamTimeoutMinutes"
                min="0"
                max="10080"
                value={antiSpamTimeoutMinutes}
                onChange={(event) => setAntiSpamTimeoutMinutes(event.target.value)}
                placeholder="Timeout (min)"
              />
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                name="antiSpamDeleteMessages"
                checked={antiSpamDeleteMessages}
                onChange={(event) => setAntiSpamDeleteMessages(event.target.checked)}
              />
              <span>Remover mensagem detectada</span>
            </label>
          </div>

          <div className="field">
            <label>Anti-link</label>
            <label className="toggle-row">
              <input
                type="checkbox"
                name="antiLinkEnabled"
                checked={antiLinkEnabled}
                onChange={(event) => setAntiLinkEnabled(event.target.checked)}
              />
              <span>Bloquear links fora da whitelist</span>
            </label>
            <div className="form-row">
              <input
                type="number"
                name="antiLinkTimeoutMinutes"
                min="0"
                max="10080"
                value={antiLinkTimeoutMinutes}
                onChange={(event) => setAntiLinkTimeoutMinutes(event.target.value)}
                placeholder="Timeout (min)"
              />
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                name="antiLinkDeleteMessages"
                checked={antiLinkDeleteMessages}
                onChange={(event) => setAntiLinkDeleteMessages(event.target.checked)}
              />
              <span>Remover mensagem com link</span>
            </label>
            <div className="field">
              <label>Roles liberadas</label>
              <input
                className="search"
                type="search"
                placeholder="Buscar cargo..."
                value={roleSearch}
                onChange={(event) => setRoleSearch(event.target.value)}
              />
              <div className="role-toolbar">
                <span className="helper">
                  Selecionados: {antiLinkAllowedRoleIds.length}
                </span>
                <button className="ghost-button" type="button" onClick={clearAllowedRoles}>
                  Limpar
                </button>
              </div>
              <div className="checkbox-grid">
                {filteredRoles.map((role) => {
                  const checked = antiLinkAllowedRoleIds.includes(role.id);
                  return (
                    <label
                      key={role.id}
                      className={`checkbox-item ${checked ? "checked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        name="antiLinkAllowedRoleIds"
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
              <label>Canais liberados</label>
              <input
                className="search"
                type="search"
                placeholder="Buscar canal..."
                value={channelSearch}
                onChange={(event) => setChannelSearch(event.target.value)}
              />
              <div className="role-toolbar">
                <span className="helper">
                  Selecionados: {antiLinkAllowedChannelIds.length}
                </span>
                <button className="ghost-button" type="button" onClick={clearAllowedChannels}>
                  Limpar
                </button>
              </div>
              <div className="checkbox-grid">
                {filteredChannels.map((channel) => {
                  const checked = antiLinkAllowedChannelIds.includes(channel.id);
                  return (
                    <label
                      key={channel.id}
                      className={`checkbox-item ${checked ? "checked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        name="antiLinkAllowedChannelIds"
                        value={channel.id}
                        checked={checked}
                        onChange={() => toggleChannel(channel.id)}
                      />
                      <span>#{channel.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="field">
            <label>Filtro de palavras</label>
            <label className="toggle-row">
              <input
                type="checkbox"
                name="wordFilterEnabled"
                checked={wordFilterEnabled}
                onChange={(event) => setWordFilterEnabled(event.target.checked)}
              />
              <span>Remover mensagens com palavras proibidas</span>
            </label>
            <textarea
              name="wordFilterWords"
              value={wordFilterWords}
              onChange={(event) => setWordFilterWords(event.target.value)}
              placeholder="Uma palavra por linha"
            />
            <div className="form-row">
              <input
                type="number"
                name="wordFilterTimeoutMinutes"
                min="0"
                max="10080"
                value={wordFilterTimeoutMinutes}
                onChange={(event) => setWordFilterTimeoutMinutes(event.target.value)}
                placeholder="Timeout (min)"
              />
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                name="wordFilterDeleteMessages"
                checked={wordFilterDeleteMessages}
                onChange={(event) => setWordFilterDeleteMessages(event.target.checked)}
              />
              <span>Remover mensagem com palavra bloqueada</span>
            </label>
          </div>

          <div className="field">
            <label>Deteccao de raid</label>
            <label className="toggle-row">
              <input
                type="checkbox"
                name="raidEnabled"
                checked={raidEnabled}
                onChange={(event) => setRaidEnabled(event.target.checked)}
              />
              <span>Alertar quando muitos membros entram rapido</span>
            </label>
            <div className="form-row">
              <input
                type="number"
                name="raidMaxJoins"
                min="2"
                max="50"
                value={raidMaxJoins}
                onChange={(event) => setRaidMaxJoins(event.target.value)}
                placeholder="Max joins"
              />
              <input
                type="number"
                name="raidIntervalSeconds"
                min="3"
                max="120"
                value={raidIntervalSeconds}
                onChange={(event) => setRaidIntervalSeconds(event.target.value)}
                placeholder="Janela (s)"
              />
            </div>
          </div>

          <button className="button" type="submit">
            Salvar configuracao
          </button>
        </form>
      </div>
    </div>
  );
}
