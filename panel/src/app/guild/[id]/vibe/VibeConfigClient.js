"use client";

import { useEffect, useMemo, useState } from "react";

const CHANNEL_TYPES = {
  GUILD_TEXT: 0,
  GUILD_ANNOUNCEMENT: 5,
  GUILD_CATEGORY: 4
};

const DEFAULT_OPTIONS = [
  { id: "top", emoji: "😄", label: "Tô no 220v" },
  { id: "deboa", emoji: "🙂", label: "De boa" },
  { id: "cansado", emoji: "😴", label: "Cansado" },
  { id: "estressado", emoji: "😡", label: "Estressado" }
];

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

function normalizeOptions(options) {
  const raw = Array.isArray(options) ? options : [];
  const byId = new Map(raw.map((o) => [String(o?.id ?? ""), o]));
  return DEFAULT_OPTIONS.map((opt) => {
    const found = byId.get(opt.id);
    return {
      id: opt.id,
      emoji: String(found?.emoji ?? opt.emoji),
      label: String(found?.label ?? opt.label)
    };
  });
}

export default function VibeConfigClient({ guildId, initialVibe, notices = [] }) {
  const [enabled, setEnabled] = useState(Boolean(initialVibe.enabled));
  const [channelId, setChannelId] = useState(initialVibe.channelId || "");
  const [channelSearch, setChannelSearch] = useState("");
  const [hour, setHour] = useState(
    Number.isFinite(initialVibe.hour) ? String(initialVibe.hour) : "20"
  );
  const [question, setQuestion] = useState(
    initialVibe.question || "Como tá a vibe hoje?"
  );
  const [options, setOptions] = useState(() => normalizeOptions(initialVibe.options));
  const [publishChannelId, setPublishChannelId] = useState(initialVibe.channelId || "");
  const [meta, setMeta] = useState({ channels: [] });
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
        setMeta({ channels: data.channels || [] });
      })
      .catch((error) => {
        if (!active) return;
        console.error(error);
        setMetaError("Não foi possível carregar canais do Discord.");
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

  return (
    <div className="grid">
      <div className="card hero">
        <div>
          <h1>Vibe Check</h1>
          <p className="helper">
            Um painel divertido pra medir a vibe do servidor e encontrar seu “gêmeo de vibe” do dia.
          </p>
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
        <form className="form" method="post" action={`/api/guild/${guildId}/vibe`}>
          <div className="field">
            <label>Ativar Vibe Check</label>
            <div className="toggle-row">
              <input
                type="checkbox"
                name="enabled"
                checked={enabled}
                onChange={(e) => setEnabled(Boolean(e.target.checked))}
              />
              <span>Posta automaticamente todos os dias no horário (UTC).</span>
            </div>
          </div>

          <div className="field">
            <label>Canal</label>
            <input
              placeholder="Buscar canal…"
              value={channelSearch}
              onChange={(e) => setChannelSearch(e.target.value)}
            />
            <select
              name="channelId"
              value={channelId}
              onChange={(e) => {
                setChannelId(e.target.value);
                if (!publishChannelId) setPublishChannelId(e.target.value);
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
            <p className="helper">
              Dica: o bot precisa de Send Messages, Embed Links e View Channel.
            </p>
          </div>

          <div className="form-row">
            <div className="field">
              <label>Horário (UTC)</label>
              <input
                type="number"
                name="hour"
                min="0"
                max="23"
                value={hour}
                onChange={(e) => setHour(e.target.value)}
              />
              <p className="helper">
                Se você estiver no Brasil (BRT), geralmente UTC = BRT + 3 (ajuste conforme horário de verão).
              </p>
            </div>
            <div className="field">
              <label>Pergunta do dia</label>
              <input
                name="question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label>Opções (4 botões)</label>
            <div className="helper">
              Emojis podem ser emoji normal (😄) ou nome/ID de emoji custom (se o bot tiver acesso).
            </div>
            <div className="card" style={{ padding: 12 }}>
              {options.map((opt, index) => (
                <div key={opt.id} className="form-row" style={{ alignItems: "end" }}>
                  <div className="field" style={{ minWidth: 120 }}>
                    <label>{opt.id}</label>
                    <input
                      name={`opt${index + 1}Emoji`}
                      value={opt.emoji}
                      onChange={(e) => {
                        const next = [...options];
                        next[index] = { ...next[index], emoji: e.target.value };
                        setOptions(next);
                      }}
                    />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Texto</label>
                    <input
                      name={`opt${index + 1}Label`}
                      value={opt.label}
                      onChange={(e) => {
                        const next = [...options];
                        next[index] = { ...next[index], label: e.target.value };
                        setOptions(next);
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button className="button" type="submit">
            Salvar Vibe Check
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Publicar mensagem</h2>
        <form className="form" method="post" action={`/api/guild/${guildId}/vibe/publish`}>
          <div className="field">
            <label>Canal</label>
            <select
              name="channelId"
              value={publishChannelId}
              onChange={(e) => setPublishChannelId(e.target.value)}
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
            <select name="pinned" defaultValue="false">
              <option value="false">Não</option>
              <option value="true">Sim</option>
            </select>
          </div>

          <button className="button" type="submit" disabled={!publishChannelId}>
            Publicar Vibe Check de hoje
          </button>
          <p className="helper">
            Publicar usa o token do bot para criar a mensagem com botões.
          </p>
        </form>
      </div>
    </div>
  );
}
