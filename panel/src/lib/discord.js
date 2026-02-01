const DISCORD_API = "https://discord.com/api/v10";

const cache = global._discordPanelCache ?? {
  guildsByToken: new Map(),
  botGetByPath: new Map()
};
global._discordPanelCache = cache;

class DiscordApiError extends Error {
  constructor(message, { status, data, retryAfter, url }) {
    super(message);
    this.name = "DiscordApiError";
    this.status = status;
    this.data = data;
    this.retryAfter = retryAfter;
    this.url = url;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseDiscordResponse(response) {
  if (response.status === 204 || response.status === 205) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (!text) return null;
  if (contentType.includes("application/json")) {
    return JSON.parse(text);
  }

  return text;
}

async function requestDiscord(path, { authHeader, method = "GET", body } = {}) {
  const url = `${DISCORD_API}${path}`;
  const maxRetries = 2;
  let attempt = 0;

  while (true) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (response.status === 429) {
      const data = await parseDiscordResponse(response);
      const retryHeader = response.headers.get("retry-after");
      const retryAfter =
        Number(data?.retry_after) ||
        Number(retryHeader) ||
        1;

      if (attempt >= maxRetries) {
        throw new DiscordApiError(
          `Discord API error: 429 ${JSON.stringify(data)}`,
          {
            status: 429,
            data,
            retryAfter,
            url
          }
        );
      }

      const delayMs = Math.ceil(retryAfter * 1000);
      await sleep(delayMs);
      attempt += 1;
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new DiscordApiError(`Discord API error: ${response.status} ${text}`, {
        status: response.status,
        data: text,
        url
      });
    }

    return parseDiscordResponse(response);
  }
}

export async function fetchDiscord(path, { token, method = "GET", body } = {}) {
  const isGuildsList = method === "GET" && path === "/users/@me/guilds";
  if (isGuildsList && token) {
    const cached = cache.guildsByToken.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
  }

  const data = await requestDiscord(path, {
    authHeader: `Bearer ${token}`,
    method,
    body
  });

  if (isGuildsList && token) {
    cache.guildsByToken.set(token, {
      value: data,
      expiresAt: Date.now() + 30 * 1000
    });
  }

  return data;
}

export async function fetchDiscordBot(path, { botToken, method = "GET", body } = {}) {
  const isCacheable =
    method === "GET" &&
    (/^\/guilds\/\d+\/channels$/.test(path) ||
      /^\/guilds\/\d+\/roles$/.test(path) ||
      /^\/users\/\d+$/.test(path));

  if (isCacheable) {
    const cached = cache.botGetByPath.get(path);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
  }

  const data = await requestDiscord(path, {
    authHeader: `Bot ${botToken}`,
    method,
    body
  });

  if (isCacheable) {
    cache.botGetByPath.set(path, {
      value: data,
      expiresAt: Date.now() + 20 * 1000
    });
  }

  return data;
}

export function hasManageGuild(permissions) {
  if (!permissions) return false;
  try {
    const bits = BigInt(permissions);
    return (bits & 0x20n) === 0x20n;
  } catch {
    return false;
  }
}
