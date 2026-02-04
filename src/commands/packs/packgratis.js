import { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { addCardsToInventory, getInventoryCounts, inventoryTotalCount, subtractLockedCounts } from "../../packs/inventoryModel.js";
import { formatCoins } from "../../ui/embeds.js";
import { renderPackOpeningPng } from "../../ui/renderPackOpening.js";
import { renderPackRevealPng } from "../../ui/renderPackReveal.js";
import { renderWalkoutScenePng } from "../../ui/renderWalkoutScene.js";
import { generatePackCards } from "../../game/packs/packEngine.js";
import { PACKS } from "../../game/packs/packCatalog.js";
import { claimFreePack } from "../../game/packs/freePackCooldown.js";
import { getSquadLockedCounts } from "../../game/squad/squadService.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function packAccent(packId) {
  if (packId === "bronze") return "#cd7f32";
  if (packId === "silver") return "#c0c0c0";
  if (packId === "gold") return "#f1c40f";
  return "#b478ff";
}

function rarityAccent(rarity) {
  if (rarity === "legendary") return "#f1c40f";
  if (rarity === "epic") return "#9b59b6";
  if (rarity === "rare") return "#3498db";
  return "#95a5a6";
}

function rarityEmoji(r) {
  if (r === "legendary") return "🌟";
  if (r === "epic") return "🟣";
  if (r === "rare") return "🔷";
  return "⚪";
}

function rarityRank(r) {
  if (r === "legendary") return 4;
  if (r === "epic") return 3;
  if (r === "rare") return 2;
  return 1;
}

const INVENTORY_LIMIT = Math.max(1, Number(process.env.INVENTORY_LIMIT ?? 150) || 150);

function packCardCount(pack) {
  return (pack?.slots ?? []).reduce((acc, s) => acc + (Number(s?.count ?? 0) || 0), 0);
}

function bestCard(cards) {
  const arr = [...(cards ?? [])];
  arr.sort((a, b) => {
    const ra = rarityRank(a?.rarity);
    const rb = rarityRank(b?.rarity);
    if (rb !== ra) return rb - ra;
    const oa = typeof a?.ovr === "number" ? a.ovr : -1;
    const ob = typeof b?.ovr === "number" ? b.ovr : -1;
    if (ob !== oa) return ob - oa;
    return String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "pt-BR");
  });
  return arr[0] ?? null;
}

function formatDuration(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m ${r}s`;
}

const data = new SlashCommandBuilder()
  .setName("packgratis")
  .setDescription("Abre um pack grátis a cada 10 minutos")
  .setDMPermission(false);

export default {
  data,
  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const gate = await claimFreePack(interaction.guildId, interaction.user.id);
    if (!gate.ok) {
      await interaction.editReply({
        content: `⏳ Ainda não! Próximo pack grátis em **${formatDuration(gate.remainingMs)}**.`
      });
      return;
    }

    const packId = "bronze";
    const pack = PACKS[packId] ?? { name: "FUTPACK GRÁTIS", emoji: "🎁" };

    const seedSalt = interaction.id;

    const opening1 = await renderPackOpeningPng({
      packId: "free",
      name: "PACK GRÁTIS",
      emoji: pack.emoji ?? "🎁",
      accent: packAccent(packId),
      phase: "closed",
      seedSalt
    });
    const openingFile1 = `opening-free-1-${Date.now()}.png`;
    const openingAttachment1 = new AttachmentBuilder(opening1, { name: openingFile1 });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎁 Abrindo pack grátis…")
          .setImage(`attachment://${openingFile1}`)
      ],
      files: [openingAttachment1]
    });

    await sleep(420);

    const openingShake = await renderPackOpeningPng({
      packId: "free",
      name: "PACK GRÁTIS",
      emoji: pack.emoji ?? "🎁",
      accent: packAccent(packId),
      phase: "shake",
      seedSalt
    });
    const openingFileShake = `opening-free-shake-${Date.now()}.png`;
    const openingAttachmentShake = new AttachmentBuilder(openingShake, { name: openingFileShake });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎁 Abrindo pack grátis…")
          .setImage(`attachment://${openingFileShake}`)
      ],
      files: [openingAttachmentShake]
    });

    await sleep(280);

    const opening2 = await renderPackOpeningPng({
      packId: "free",
      name: "PACK GRÁTIS",
      emoji: pack.emoji ?? "🎁",
      accent: packAccent(packId),
      phase: "burst",
      seedSalt
    });
    const openingFile2 = `opening-free-2-${Date.now()}.png`;
    const openingAttachment2 = new AttachmentBuilder(opening2, { name: openingFile2 });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("💥 Revelando pack grátis!")
          .setImage(`attachment://${openingFile2}`)
      ],
      files: [openingAttachment2]
    });

    await sleep(650);

    const packObj = PACKS[packId];
    const invCounts = await getInventoryCounts(interaction.guildId, interaction.user.id);
    const lockedCounts = await getSquadLockedCounts(interaction.guildId, interaction.user.id);
    const invTotal = inventoryTotalCount(subtractLockedCounts(invCounts, lockedCounts));
    const willAdd = packCardCount(packObj);
    const after = invTotal + willAdd;

    if (after > INVENTORY_LIMIT) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Time Cheio")
            .setDescription(
              `Seu inventário (sem os escalados) está com **${invTotal}/${INVENTORY_LIMIT}** cartas.\n` +
              `Abrir o pack grátis adicionaria **${willAdd}** (ficaria **${after}/${INVENTORY_LIMIT}**).\n\n` +
              "Use **/vender** para liberar espaço."
            )
            .setColor(0xe74c3c)
        ],
        files: []
      });
      return;
    }

    const pulled = await generatePackCards(packId);
    await addCardsToInventory(interaction.guildId, interaction.user.id, pulled);

    const top = bestCard(pulled);

    const topOvr = typeof top?.ovr === "number" ? top.ovr : 0;
    if (top && (top.rarity === "epic" || top.rarity === "legendary" || topOvr >= 90)) {
      const topPng = await renderWalkoutScenePng({
        card: top,
        title: "WALKOUT",
        subtitle: "PACK GRÁTIS",
        badge: `${topOvr} OVR`
      });
      const topFile = `walkout-free-${top.id}-${Date.now()}.png`;
      const topAttachment = new AttachmentBuilder(topPng, { name: topFile });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`🔥 WALKOUT! ${rarityEmoji(top.rarity)} ${top.name}`)
            .setImage(`attachment://${topFile}`)
        ],
        files: [topAttachment]
      });

      await sleep(1100);
    }

    const banner = await renderPackRevealPng({
      cards: pulled,
      title: "PACK GRÁTIS",
      qty: pulled.length,
      accent: top ? rarityAccent(top.rarity) : packAccent(packId)
    });

    const fileName = `reveal-free-${Date.now()}.png`;
    const attachment = new AttachmentBuilder(banner, { name: fileName });

    const list = pulled
      .map((c) => {
        const ovr = typeof c.ovr === "number" ? c.ovr : "??";
        const val = typeof c.value === "number" ? `${formatCoins(c.value)} 🪙` : "—";
        return `${rarityEmoji(c.rarity)} **${c.name}** • OVR **${ovr}** • ${val}`;
      })
      .join("\n");

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`🎴 Pack grátis aberto!`)
          .setDescription(list)
          .setImage(`attachment://${fileName}`)
      ],
      files: [attachment]
    });
  }
};
