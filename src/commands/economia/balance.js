import { SlashCommandBuilder } from "discord.js";
import { getBalance } from "../../economy/economyService.js";
import { economyEmbed, formatCoins } from "../../ui/embeds.js";

const data = new SlashCommandBuilder()
  .setName("balance")
  .setDescription("Mostra seu saldo de moedas")
  .setDMPermission(false);

export default {
  data,
  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    try {
      const balance = await getBalance(guildId, userId);
      await interaction.reply({
        embeds: [
          economyEmbed({
            title: "💰 Seu saldo (Global)",
            description: `<@${userId}> você tem **${formatCoins(balance)}** 🪙.`,
            color: 0x3498db
          })
        ]
      });
    } catch (err) {
      console.error("balance error:", err);
      await interaction.reply({
        embeds: [
          economyEmbed({
            title: "❌ Erro",
            description: "Não consegui acessar a economia (Mongo). Verifique o MONGO_URI.",
            color: 0xe74c3c
          })
        ],
        ephemeral: true
      });
    }
  }
};
