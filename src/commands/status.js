import mongoose from "mongoose";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Mostra status, uptime e saude do bot")
  .setDMPermission(false);

function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let value = b;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function mongoStateLabel(state) {
  switch (state) {
    case 0:
      return "desconectado";
    case 1:
      return "conectado";
    case 2:
      return "conectando";
    case 3:
      return "desconectando";
    default:
      return "desconhecido";
  }
}

export default {
  data,
  async execute(interaction) {
    const uptime = formatDuration(process.uptime());
    const wsPing = interaction.client?.ws?.ping;
    const mem = process.memoryUsage();
    const mongoState = mongoStateLabel(mongoose.connection?.readyState);
    const guilds = interaction.client?.guilds?.cache?.size ?? 0;
    const commands = interaction.client?.commands?.size ?? 0;

    const embed = new EmbedBuilder()
      .setTitle("Master Bot • Status")
      .setColor(0x2fffe0)
      .addFields(
        { name: "Uptime", value: uptime, inline: true },
        { name: "WS Ping", value: wsPing != null ? `${wsPing}ms` : "n/a", inline: true },
        { name: "MongoDB", value: mongoState, inline: true },
        { name: "Servidores", value: String(guilds), inline: true },
        { name: "Comandos", value: String(commands), inline: true },
        { name: "Memoria", value: `${formatBytes(mem.rss)} (rss)`, inline: true }
      )
      .setFooter({ text: "Se algo estiver lento, verifique Mongo e intents." });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

