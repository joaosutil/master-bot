import { Collection } from "discord.js";

function parsePrefix() {
  const raw = String(process.env.BOT_PREFIX ?? ".").trim();
  return raw || ".";
}

function tokenize(content) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const { ephemeral, ...rest } = payload;
  return rest;
}

class MessageInteractionAdapter {
  constructor(message, { commandName, subcommand, args } = {}) {
    this.id = message.id;
    this.client = message.client;
    this.guildId = message.guildId;
    this.guild = message.guild;
    this.channel = message.channel;
    this.user = message.author;
    this.member = message.member ?? null;
    this.memberPermissions = message.member?.permissions ?? null;

    this.deferred = false;
    this.replied = false;
    this._replyMessage = null;

    const parsedArgs = args ?? [];

    this.commandName = commandName;
    this.options = {
      getSubcommand: (_required) => subcommand ?? null,
      getString: (name, required = false) => {
        const idx = parsedArgs.findIndex((a) => a === `--${name}`);
        if (idx !== -1 && parsedArgs[idx + 1]) return parsedArgs[idx + 1];
        if (required) throw new Error(`missing option: ${name}`);
        return null;
      },
      getInteger: (name, required = false) => {
        const s = this.options.getString(name, required);
        if (s == null) return null;
        const n = Number.parseInt(String(s), 10);
        if (!Number.isFinite(n)) return null;
        return n;
      },
      getBoolean: (name) => {
        return parsedArgs.includes(`--${name}`) ? true : null;
      },
      getUser: (_name) => {
        return message.mentions?.users?.first?.() ?? null;
      },
      getChannel: (name) => {
        const idx = parsedArgs.findIndex((a) => a === `--${name}`);
        const raw = idx !== -1 ? parsedArgs[idx + 1] : null;
        if (!raw) return null;

        const m = String(raw).match(/^<#(\d+)>$/);
        const id = m?.[1] ?? (String(raw).match(/^\d+$/) ? String(raw) : null);
        if (!id) return null;

        return message.guild?.channels?.cache?.get?.(id) ?? null;
      }
    };
  }

  inGuild() {
    return Boolean(this.guildId);
  }

  inCachedGuild() {
    return Boolean(this.guildId && this.guild);
  }

  async deferReply(_opts = {}) {
    this.deferred = true;
    try {
      await this.channel.sendTyping?.();
    } catch {}
  }

  async reply(payload) {
    this.replied = true;
    const sent = await this.channel.send(sanitizePayload(payload));
    this._replyMessage = sent;
    return sent;
  }

  async editReply(payload) {
    if (!this._replyMessage) return await this.reply(payload);
    const edited = await this._replyMessage.edit(sanitizePayload(payload));
    return edited;
  }

  async fetchReply() {
    return this._replyMessage;
  }
}

function buildAliasMap(commands) {
  const map = new Map();
  const set = (alias, name) => {
    if (commands.has(name)) map.set(alias, name);
  };

  set("pack", "pack");
  set("packs", "pack");
  set("inventario", "inventory");
  set("inv", "inventory");
  set("vender", "vender");
  set("sell", "vender");
  set("jogar", "jogar");
  set("play", "jogar");
  set("escalar", "escalar");
  set("time", "escalar");
  set("ajuda", "ajuda");
  set("help", "ajuda");

  // Music
  set("tocar", "tocar");
  set("play", "tocar");
  set("pausar", "pausar");
  set("pause", "pausar");
  set("resumir", "resumir");
  set("resume", "resumir");
  set("pular", "pular");
  set("skip", "pular");
  set("parar", "parar");
  set("stop", "parar");
  set("tocando", "tocando");
  set("np", "tocando");
  set("fila", "fila");
  set("queue", "fila");
  set("volume", "volume");
  set("vol", "volume");

  return map;
}

function parseSubcommandFor(commandName, args) {
  if (commandName === "jogar") {
    const a0 = String(args[0] ?? "").toLowerCase();
    if (a0 === "rank" || a0 === "ranked") return { subcommand: "rank", rest: args.slice(1) };
    return { subcommand: "casual", rest: a0 ? args.slice(1) : args };
  }

  if (commandName === "escalar") {
    const a0 = String(args[0] ?? "").toLowerCase();
    const known = new Set(["ver", "auto", "set", "remover", "limpar", "formacao"]);
    if (known.has(a0)) return { subcommand: a0, rest: args.slice(1) };
    return { subcommand: "ver", rest: args };
  }

  return { subcommand: null, rest: args };
}

function normalizeArgsForCommand(commandName, args) {
  // Allow ergonomic positional args for common commands.
  if (commandName === "limpar") {
    // .limpar 10 => /limpar quantidade:10
    const out = [...args];
    const hasQtd = out.includes("--quantidade");
    if (!hasQtd && out.length && /^\d+$/.test(String(out[0]))) {
      const qty = out.shift();
      out.unshift("--quantidade", qty);
    }
    return out;
  }

  if (commandName === "tocar") {
    // .tocar thunderstruck => /tocar musica:"thunderstruck"
    // .tocar --musica thunderstruck => keep as-is
    const out = [...args];
    const hasMusic = out.includes("--musica");
    if (!hasMusic) {
      const query = out.join(" ").trim();
      if (query) return ["--musica", query];
    }
    return out;
  }

  if (commandName === "volume") {
    // .volume 50 => /volume valor:50
    const out = [...args];
    const hasVal = out.includes("--valor");
    if (!hasVal && out.length && /^-?\d+(\.\d+)?$/.test(String(out[0]))) {
      const v = out.shift();
      out.unshift("--valor", v);
    }
    return out;
  }

  return args;
}

export async function handlePrefixCommands(message) {
  if (!message?.guildId) return;
  if (!message?.content) return;
  if (message.author?.bot) return;

  const prefix = parsePrefix();
  if (!message.content.startsWith(prefix)) return;

  const content = message.content.slice(prefix.length).trim();
  if (!content) return;

  const tokens = tokenize(content);
  const rawCmd = String(tokens[0] ?? "").toLowerCase();
  const args = tokens.slice(1);

  const commands = message.client?.commands ?? new Collection();
  const aliasMap = buildAliasMap(commands);
  const commandName = aliasMap.get(rawCmd) ?? rawCmd;
  const command = commands.get(commandName);
  if (!command?.execute) return;

  const { subcommand, rest } = parseSubcommandFor(commandName, args);
  const normalizedArgs = normalizeArgsForCommand(commandName, rest);
  const adapter = new MessageInteractionAdapter(message, {
    commandName,
    subcommand,
    args: normalizedArgs
  });

  try {
    await command.execute(adapter, { client: message.client });
  } catch (err) {
    console.error("[prefixCommands] erro:", err);
    try {
      await message.reply("❌ Erro ao executar comando. Veja o console.");
    } catch {}
  }
}
