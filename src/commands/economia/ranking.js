import { SlashCommandBuilder } from "discord.js";
import { getTopBalances } from "../../economy/economyService.js";
import { economyEmbed, formatCoins } from "../../ui/embeds.js";

const data = new SlashCommandBuilder()
  .setName("ranking")
  .setDescription("Mostra o top 10 usuários com mais moedas")
  .setDMPermission(false);

export default {
  data,
  async execute(interaction) {
    const guildId = interaction.guildId;

    await interaction.deferReply();

    try {
      const top = await getTopBalances(guildId, 10);

      if (!top.length) {
        await interaction.editReply({
          embeds: [
            economyEmbed({
              title: "🏆 Ranking",
              description: "Ainda não tem ninguém no ranking.",
              color: 0x95a5a6
            })
          ]
        });
        return;
      }

      const lines = top.map((u, i) => {
        const medal = i === 0 ?"🥇" : i === 1 ?"🥈" : i === 2 ?"🥉" : `#${i + 1}`;
        return `${medal} <@${u.userId}>: **${formatCoins(u.balance)}** 🪙`;
      });

      await interaction.editReply({
        embeds: [
          economyEmbed({
            title: "🏆 Ranking de moedas (Top 10)",
            description: lines.join("\n"),
            color: 0xf1c40f,
            footer: "Ganhe moedas com /daily e abra packs com /pack"
          })
        ]
      });
    } catch (err) {
      console.error("ranking error:", err);
      await interaction.editReply({
        embeds: [
          economyEmbed({
            title: "❌ Erro",
            description: "Não consegui pegar o ranking (Mongo).",
            color: 0xe74c3c
          })
        ]
      });
    }
  }
};

