import { ActivityType } from "discord.js";

const DEFAULT_ACTIVITIES = [
  { type: ActivityType.Playing, name: "/ajuda" },
  { type: ActivityType.Playing, name: "/ticket painel" },
  { type: ActivityType.Playing, name: "/ticket abrir" },
  { type: ActivityType.Playing, name: "/expedicao iniciar" },
  { type: ActivityType.Playing, name: "/packs" },
  { type: ActivityType.Playing, name: "/memoria adicionar" },
  { type: ActivityType.Watching, name: "os tickets do servidor" },
  { type: ActivityType.Listening, name: "a comunidade" }
];

function clampMs(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(30_000, Math.min(30 * 60_000, n));
}

export function startPresenceRotator(client, options = {}) {
  const enabled =
    String(process.env.PRESENCE_ROTATE ?? "1").toLowerCase() !== "0" &&
    options.enabled !== false;

  if (!enabled) return () => {};

  const activities = Array.isArray(options.activities) && options.activities.length
    ? options.activities
    : DEFAULT_ACTIVITIES;

  const intervalMs = clampMs(process.env.PRESENCE_ROTATE_MS, 120_000);
  const randomize = String(process.env.PRESENCE_ROTATE_RANDOM ?? "1").toLowerCase() !== "0";

  let idx = 0;

  function pickNext() {
    if (!activities.length) return null;
    if (randomize) return activities[Math.floor(Math.random() * activities.length)];
    const item = activities[idx % activities.length];
    idx += 1;
    return item;
  }

  async function applyOnce() {
    try {
      const activity = pickNext();
      if (!activity) return;
      if (!client.user) return;
      await client.user.setPresence({
        activities: [activity],
        status: "online"
      });
    } catch {}
  }

  applyOnce();
  const timer = setInterval(applyOnce, intervalMs);

  return () => clearInterval(timer);
}

