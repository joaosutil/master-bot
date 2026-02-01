const keyToEnv = {
  token: "DISCORD_TOKEN",
  clientId: "CLIENT_ID",
  guildId: "GUILD_ID",
  mongoUri: "MONGO_URI",
  panelBaseUrl: "PANEL_BASE_URL"
};

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  mongoUri: process.env.MONGO_URI,
  panelBaseUrl: process.env.PANEL_BASE_URL
};

export function assertConfig(required = []) {
  const missing = required
    .filter((key) => !config[key])
    .map((key) => keyToEnv[key] ?? key);

  if (missing.length) {
    throw new Error(`Missing config: ${missing.join(", ")}`);
  }
}
