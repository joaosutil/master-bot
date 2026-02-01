import { SlashCommandBuilder } from "discord.js";

const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Mostra a latencia do bot");

export default {
  data,
  async execute(interaction) {
    const sent = await interaction.reply({
      content: "Pong!",
      fetchReply: true
    });

    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(`Pong! Latencia: ${latency}ms`);
  }
};