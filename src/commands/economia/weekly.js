import { SlashCommandBuilder } from "discord.js";
import { claimWeekly, formatTime } from "../../economy/economyService.js";
import { economyEmbed, formatCoins } from "../../ui/embeds.js";

const data = new SlashCommandBuilder()
  .setName("weekly")
  .setDescription("Resgata sua recompensa semanal (7 dias)")
  .setDMPermission(false);

export default {
  data,
  async execute(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await claimWeekly(guildId, userId);

      if (!result.ok) {
        await interaction.editReply({
          embeds: [
            economyEmbed({
              title: "⏳ Weekly já resgatado",
              description:
                `Você já pegou seu weekly.\n` +
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
            title: "✅ Weekly resgatado!",
            description:
              `Você ganhou **${formatCoins(result.reward)}** 🪙.\n` +
              `Saldo atual: **${formatCoins(result.balance)}** 🪙`,
            color: 0x2ecc71,
            footer: "Dica: use /daily e /pack"
          })
        ]
      });
    } catch (err) {
      console.error("weekly error:", err);
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

