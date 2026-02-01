import "dotenv/config";
import { REST, Routes } from "discord.js";
import { assertConfig, config } from "./config.js";
import { loadCommands } from "./loaders/commands.js";

assertConfig(["token", "clientId"]);

const { data } = await loadCommands();
const rest = new REST({ version: "10" }).setToken(config.token);

try {
  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: data
    });
    console.log(`Registered ${data.length} guild commands.`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body: data });
    console.log(`Registered ${data.length} global commands.`);
    console.log("Global commands can take up to 1 hour to update.");
  }
} catch (error) {
  console.error("Failed to register commands:", error);
  process.exit(1);
}