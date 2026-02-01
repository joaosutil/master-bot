import { SlashCommandBuilder } from "discord.js";
import { claimDaily, formatTime } from "../../economy/economyService.js";
import { economyEmbed, formatCoins } from "../../ui/embeds.js";

const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Resgata sua recompensa diária (24h)")
  .setDMPermission(false);

export default {
  data,
  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await claimDaily(guildId, userId);

      if (!result.ok) {
        await interaction.editReply({
          embeds: [
            economyEmbed({
              title: "⏳ Daily já resgatado",
              description:
                `Você já pegou seu daily.\n` +
                `Volte em **${formatTime(result.remainingMs)}**.\n` +
                `Saldo: **${formatCoins(result.balance)}** 🪙`,
              color: 0xf39c12
            })
          ]
        });
        return;
      }

      await interaction.editReply({
        embeds: [
          economyEmbed({
            title: "✅ Daily resgatado!",
            description:
              `Você ganhou **${formatCoins(result.reward)}** 🪙.\n` +
              `Saldo atual: **${formatCoins(result.balance)}** 🪙`,
            color: 0x2ecc71,
            footer: "Dica: use /pack para abrir packs"
          })
        ]
      });
    } catch (err) {
      console.error("daily error:", err);
      await interaction.editReply({
        embeds: [
          economyEmbed({
            title: "❌ Erro",
            description: "Não consegui acessar a economia (Mongo). Verifique o MONGO_URI.",
            color: 0xe74c3c
          })
        ]
      });
    }
  }
};

