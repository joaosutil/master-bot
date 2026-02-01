import { SlashCommandBuilder } from "discord.js";
import { getInventoryCounts } from "../../packs/inventoryModel.js";
import { getCardPool } from "../../cards/cardsStore.js";
import { economyEmbed, rarityColor, emojiByRarity } from "../../ui/embeds.js";

function rarityRank(r) {
  if (r === "legendary") return 4;
  if (r === "epic") return 3;
  if (r === "rare") return 2;
  return 1;
}

const data = new SlashCommandBuilder()
  .setName("inventory")
  .setDescription("Mostra seu inventário de cartas")
  .setDMPermission(false)
  .addUserOption((opt) =>
    opt.setName("usuario").setDescription("Ver inventário de outra pessoa")
  );

export default {
  data,
  async execute(interaction) {
    const guildId = interaction.guildId;
    const targetUser = interaction.options.getUser("usuario") ?? interaction.user;

    await interaction.deferReply();

    const counts = await getInventoryCounts(guildId, targetUser.id);
    const entries = Object.entries(counts)
      .map(([cardId, count]) => ({ cardId, count }))
      .filter((x) => x.count > 0);

    if (!entries.length) {
      await interaction.editReply({
        embeds: [
          economyEmbed({
            title: "🎒 Inventário",
            description: `📭 ${targetUser.username} ainda não tem cartas.`,
            color: 0x95a5a6
          })
        ]
      });
      return;
    }

    const pool = await getCardPool();
    const poolMap = new Map(pool.map((c) => [c.id, c]));

    const detailed = entries
      .map((entry) => {
        const card = poolMap.get(entry.cardId);
        return { count: entry.count, card };
      })
      .filter((x) => x.card);

    detailed.sort((a, b) => {
      const ra = rarityRank(a.card.rarity);
      const rb = rarityRank(b.card.rarity);
      if (rb !== ra) return rb - ra;
      return a.card.name.localeCompare(b.card.name, "pt-BR");
    });

    const lines = [];
    for (const item of detailed) {
      lines.push(
        `${emojiByRarity(item.card.rarity)} **${item.card.name}** (${item.card.pos}) x**${item.count}**`
      );
      if (lines.join("\n").length > 3200) {
        lines.push("… (inventário grande demais; depois a gente pagina com botões)");
        break;
      }
    }

    const best = detailed[0]?.card?.rarity ?? "common";

    await interaction.editReply({
      embeds: [
        economyEmbed({
          title: `🎒 Inventário de ${targetUser.username}`,
          description: `Cartas diferentes: **${detailed.length}**\n\n${lines.join("\n")}`,
          color: rarityColor(best),
          footer: "Abra mais com /pack"
        })
      ]
    });
  }
};

