import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Collection } from "discord.js";

async function getCommandFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getCommandFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function loadCommands() {
  const commands = new Collection();
  const data = [];
  const commandsPath = path.join(process.cwd(), "src", "commands");
  const files = await getCommandFiles(commandsPath);

  for (const file of files) {
    const mod = await import(pathToFileURL(file));
    const command = mod.default ?? mod;

    if (!command?.data?.name || typeof command.execute !== "function") {
      console.warn(`Skipping invalid command file: ${file}`);
      continue;
    }

    commands.set(command.data.name, command);
    data.push(command.data.toJSON());
  }

  return { commands, data };
}