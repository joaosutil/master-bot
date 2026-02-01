import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import { economyEmbed, rarityLabel, rarityColor, emojiByRarity, formatCoins } from "../../ui/embeds.js";
import { renderCardPng } from "../../ui/renderCard.js";
import { getCardPool } from "../../cards/cardsStore.js";

function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function formatStats(stats = {}) {
  const order = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
  const parts = order
    .filter((k) => stats[k] != null)
    .map((k) => `**${k}** ${stats[k]}`);
  return parts.length ? parts.join("  |  ") : "Sem stats.";
}

function findCards(pool, query) {
  const q = normalize(query);
  if (!q) return [];

  const byId = pool.find((c) => normalize(c.id) === q);
  if (byId) return [byId];

  const exact = pool.filter((c) => normalize(c.name) === q);
  if (exact.length) return exact;

  return pool.filter((c) => normalize(c.name).includes(q));
}

const data = new SlashCommandBuilder()
  .setName("card")
  .setDescription("Mostra detalhes e a renderização de uma carta")
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt
      .setName("nome")
      .setDescription('Nome ou ID (ex: "Pelé" ou "p_123456")')
      .setRequired(true)
  )
  .addBooleanOption((opt) =>
    opt.setName("publico").setDescription("Se true, envia no chat (padrão: só você vê)")
  );

export default {
  data,
  async execute(interaction) {
    const query = interaction.options.getString("nome", true);
    const publico = interaction.options.getBoolean("publico") ?? false;

    const pool = await getCardPool();
    const matches = findCards(pool, query);

    if (!matches.length) {
      await interaction.reply({
        embeds: [
          economyEmbed({
            title: "🔎 Não encontrei essa carta",
            description:
              `Busca: **"${query}"**\n\n` +
              `Dicas:\n` +
              `• Use **/cards** para ver a lista\n` +
              `• Tente buscar por parte do nome (ex: "ney")\n` +
              `• Use o **ID** da carta (ex: p_123...)`,
            color: 0xe67e22
          })
        ],
        ephemeral: !publico
      });
      return;
    }

    if (matches.length > 1) {
      const top = matches.slice(0, 12).map((c, i) => {
        const ovr = typeof c.ovr === "number" ? c.ovr : "??";
        return `${i + 1}. ${emojiByRarity(c.rarity)} **${c.name}** (${c.pos}) • OVR **${ovr}** • ID: \`${c.id}\``;
      });

      await interaction.reply({
        embeds: [
          economyEmbed({
            title: "🧩 Encontrei várias cartas",
            description:
              `Sua busca: **"${query}"**\n\n` +
              top.join("\n") +
              `\n\n➡️ Dica: copie o **ID** e rode: **/card nome:<ID>**`,
            color: 0x3498db,
            footer: `Mostrando ${Math.min(12, matches.length)} de ${matches.length}`
          })
        ],
        ephemeral: !publico
      });
      return;
    }

    const c = matches[0];

    await interaction.deferReply({ ephemeral: !publico });

    const png = await renderCardPng(c);
    const fileName = `card_${c.id}.png`;
    const attachment = new AttachmentBuilder(png, { name: fileName });

    const ovr = typeof c.ovr === "number" ? c.ovr : "??";
    const country = c.countryCode ? String(c.countryCode).toUpperCase() : "—";
    const club = c.clubName ?? "—";
    const value = typeof c.value === "number" ? formatCoins(c.value) : "—";

    const embed = economyEmbed({
      title: `${emojiByRarity(c.rarity)} ${c.name} (${c.pos})`,
      description:
        `Raridade: **${rarityLabel(c.rarity)}**\n` +
        `OVR: **${ovr}**\n` +
        `Valor: **${value}** 🪙\n` +
        `País: **${country}**\n` +
        `Clube: **${club}**\n\n` +
        `📊 ${formatStats(c.stats)}`,
      color: rarityColor(c.rarity),
      footer: `ID: ${c.id}`
    });

    embed.setImage(`attachment://${fileName}`);

    await interaction.editReply({
      embeds: [embed],
      files: [attachment]
    });
  }
};

