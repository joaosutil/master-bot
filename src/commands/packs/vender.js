import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder
} from "discord.js";
import mongoose from "mongoose";

import { Inventory, getInventoryCounts, inventoryTotalCount } from "../../packs/inventoryModel.js";
import { getCardPool } from "../../cards/cardsStore.js";
import { addBalance } from "../../economy/economyService.js";
import { emojiByRarity, formatCoins, rarityColor } from "../../ui/embeds.js";

const PAGE_SIZE = 25; // select menu limit
const INVENTORY_LIMIT = Math.max(1, Number(process.env.INVENTORY_LIMIT ?? 150) || 150);

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function rarityRank(r) {
  if (r === "legendary") return 4;
  if (r === "epic") return 3;
  if (r === "rare") return 2;
  return 1;
}

function sortCards(a, b) {
  const oa = typeof a?.ovr === "number" ? a.ovr : -1;
  const ob = typeof b?.ovr === "number" ? b.ovr : -1;
  if (ob !== oa) return ob - oa;

  const ra = rarityRank(a?.rarity);
  const rb = rarityRank(b?.rarity);
  if (rb !== ra) return rb - ra;

  return String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "pt-BR");
}

function buildOwnedList(counts, poolMap) {
  const items = [];
  for (const [cardId, countRaw] of Object.entries(counts ?? {})) {
    const count = Number(countRaw ?? 0);
    if (!Number.isFinite(count) || count <= 0) continue;
    const card = poolMap.get(cardId);
    if (!card) continue;
    items.push({ cardId, count: Math.trunc(count), card });
  }
  items.sort((a, b) => sortCards(a.card, b.card));
  return items;
}

function selectedSummary(selected, itemsById) {
  let cards = 0;
  let stacks = 0;
  let coins = 0;

  for (const id of selected) {
    const it = itemsById.get(id);
    if (!it) continue;
    stacks++;
    cards += it.count;
    const val = Number(it.card?.value ?? 0);
    if (Number.isFinite(val) && val > 0) coins += val * it.count;
  }

  return { cards, stacks, coins };
}

function pageSlice(items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = clamp(page, 1, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  return {
    safePage,
    totalPages,
    slice: items.slice(start, start + PAGE_SIZE)
  };
}

function buildEmbed({ user, invTotal, items, selected, itemsById, page, totalPages }) {
  const sel = selectedSummary(selected, itemsById);

  const topColor =
    items[0]?.card?.rarity ? rarityColor(items[0].card.rarity) : 0x3498db;

  const selectedItems = Array.from(selected)
    .map((id) => itemsById.get(id))
    .filter(Boolean)
    .sort((a, b) => sortCards(a.card, b.card));

  const lines = [];
  if (!selectedItems.length) {
    lines.push("Nenhuma carta selecionada.");
    lines.push("");
    lines.push("Abra o menu abaixo para escolher cartas e depois clique **Vender seleção**.");
  } else {
    for (const it of selectedItems.slice(0, 18)) {
      const ovr = typeof it.card?.ovr === "number" ? it.card.ovr : "??";
      const valEach = Number(it.card?.value ?? 0);
      const total = Number.isFinite(valEach) ? valEach * it.count : 0;
      lines.push(
        `✅ ${emojiByRarity(it.card.rarity)} **${it.card.name}** (${it.card.pos}) • OVR **${ovr}** • x**${it.count}** • ${formatCoins(total)} 🪙`
      );
    }
    if (selectedItems.length > 18) lines.push(`… +${selectedItems.length - 18} stacks`);
  }

  const desc =
    `Inventário: **${invTotal}/${INVENTORY_LIMIT}** cartas\n` +
    `Stacks: **${items.length}**\n\n` +
    `**Selecionado:** ${sel.stacks} stacks • ${sel.cards} cartas • **${formatCoins(sel.coins)} 🪙**\n\n` +
    lines.join("\n");

  return new EmbedBuilder()
    .setTitle("💸 Vender Cartas")
    .setDescription(desc)
    .setColor(topColor)
    .setFooter({ text: `${user.username} • Página ${page}/${totalPages}` });
}

function buildSelect(customId, slice) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Selecionar uma carta para vender (stack inteiro)…")
    .setMinValues(1)
    .setMaxValues(1);

  if (!slice.length) {
    menu.addOptions({ label: "Sem cartas", value: "none" }).setDisabled(true);
    return new ActionRowBuilder().addComponents(menu);
  }

  menu.addOptions(
    slice.map((it) => {
      const ovr = typeof it.card?.ovr === "number" ? it.card.ovr : "??";
      const label = `${ovr} ${it.card.pos} ${it.card.name}`.slice(0, 100);
      const desc = `x${it.count} • ${formatCoins(it.card.value ?? 0)} 🪙 cada`.slice(0, 100);
      return { label, value: it.cardId, description: desc, emoji: emojiByRarity(it.card.rarity) };
    })
  );

  return new ActionRowBuilder().addComponents(menu);
}

function buildNavButtons({ prevId, nextId, selectAllId, clearId, closeId }, { page, totalPages }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(prevId)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("⬅️")
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(nextId)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("➡️")
      .setDisabled(page >= totalPages),
    new ButtonBuilder()
      .setCustomId(selectAllId)
      .setStyle(ButtonStyle.Primary)
      .setLabel("Selecionar tudo (<90)"),
    new ButtonBuilder()
      .setCustomId(clearId)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Limpar"),
    new ButtonBuilder()
      .setCustomId(closeId)
      .setStyle(ButtonStyle.Danger)
      .setLabel("Fechar")
  );
}

function buildSellButton(sellId, disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(sellId)
      .setStyle(ButtonStyle.Success)
      .setLabel("Vender seleção")
      .setDisabled(disabled)
  );
}

async function sellSelection({ guildId, userId, selected, itemsById }) {
  if (mongoose.connection?.readyState !== 1) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const toSell = [];
  for (const id of selected) {
    const it = itemsById.get(id);
    if (!it) continue;
    toSell.push({ cardId: id, count: it.count, value: Number(it.card?.value ?? 0) || 0 });
  }
  if (!toSell.length) return { ok: false, reason: "empty" };

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const inc = {};
    let earned = 0;

    for (const it of toSell) {
      if (!it.cardId || !it.count) continue;
      inc[`counts.${it.cardId}`] = (inc[`counts.${it.cardId}`] ?? 0) - it.count;
      earned += Math.max(0, it.value) * it.count;
    }

    await Inventory.updateOne({ guildId, userId }, { $inc: inc }, { upsert: true, session });
    if (earned > 0) await addBalance(guildId, userId, earned, session);

    await session.commitTransaction();
    return { ok: true, earned };
  } finally {
    session.endSession();
  }
}

const data = new SlashCommandBuilder()
  .setName("vender")
  .setDescription("Vende cartas do seu inventário (libera espaço para abrir packs)")
  .setDMPermission(false);

export default {
  data,
  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    const pool = await getCardPool();
    const poolMap = new Map(pool.map((c) => [c.id, c]));

    let counts = await getInventoryCounts(guildId, userId);
    let invTotal = inventoryTotalCount(counts);

    let items = buildOwnedList(counts, poolMap);
    if (!items.length) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("💸 Vender Cartas")
            .setDescription("Você não tem cartas para vender.")
            .setColor(0x95a5a6)
        ],
        components: []
      });
      return;
    }

    const itemsById = new Map(items.map((it) => [it.cardId, it]));
    const selected = new Set();
    let page = 1;

    const selectId = `sell_select:${interaction.id}`;
    const prevId = `sell_prev:${interaction.id}`;
    const nextId = `sell_next:${interaction.id}`;
    const selectAllId = `sell_all:${interaction.id}`;
    const clearId = `sell_clear:${interaction.id}`;
    const sellId = `sell_sell:${interaction.id}`;
    const closeId = `sell_close:${interaction.id}`;

    function buildView() {
      const paged = pageSlice(items, page);
      page = paged.safePage;
      const embed = buildEmbed({
        user: interaction.user,
        invTotal,
        items,
        selected,
        itemsById,
        page: paged.safePage,
        totalPages: paged.totalPages
      });
      return {
        embeds: [embed],
        components: [
          buildSelect(selectId, paged.slice),
          buildNavButtons({ prevId, nextId, selectAllId, clearId, closeId }, { page: paged.safePage, totalPages: paged.totalPages }),
          buildSellButton(sellId, selected.size === 0)
        ]
      };
    }

    await interaction.editReply(buildView());
    const msg = await interaction.fetchReply();

    const filter = (i) =>
      i.user.id === interaction.user.id &&
      [selectId, prevId, nextId, selectAllId, clearId, sellId, closeId].includes(i.customId);

    const collector = msg.createMessageComponentCollector({ filter, time: 180_000 });

    collector.on("collect", async (i) => {
      try {
        if (i.customId === closeId) {
          collector.stop("closed");
          await i.update({ embeds: [new EmbedBuilder().setTitle("✅ Fechado").setColor(0x95a5a6)], components: [] });
          return;
        }

        if (i.customId === prevId) page -= 1;
        if (i.customId === nextId) page += 1;

        if (i.customId === clearId) {
          selected.clear();
        }

        if (i.customId === selectAllId) {
          // Não seleciona 90+ automaticamente (só manual)
          for (const it of items) {
            const ovr = typeof it.card?.ovr === "number" ? it.card.ovr : 0;
            if (ovr >= 90) continue;
            selected.add(it.cardId);
          }
        }

        if (i.customId === selectId) {
          const picked = i.values?.[0];
          if (picked && picked !== "none") {
            selected.add(picked);
          }
        }

        if (i.customId === sellId) {
          if (!selected.size) {
            await i.update(buildView());
            return;
          }

          const before = selectedSummary(selected, itemsById);
          const sold = await sellSelection({ guildId, userId, selected, itemsById });
          selected.clear();

          counts = await getInventoryCounts(guildId, userId);
          invTotal = inventoryTotalCount(counts);
          items = buildOwnedList(counts, poolMap);
          itemsById.clear();
          for (const it of items) itemsById.set(it.cardId, it);

          if (!items.length) {
            collector.stop("empty");
            await i.update({
              embeds: [
                new EmbedBuilder()
                  .setTitle("💸 Venda concluída")
                  .setDescription(`Você vendeu **${before.cards}** cartas e ganhou **${formatCoins(sold.earned)} 🪙**.`)
                  .setColor(0x2ecc71)
              ],
              components: []
            });
            return;
          }

          await i.update({
            embeds: [
              new EmbedBuilder()
                .setTitle("💸 Venda concluída")
                .setDescription(`Você vendeu **${before.cards}** cartas e ganhou **${formatCoins(sold.earned)} 🪙**.\n\nInventário agora: **${invTotal}/${INVENTORY_LIMIT}**.`)
                .setColor(0x2ecc71)
            ],
            components: []
          });

          // volta para a UI após um “toast” rápido
          setTimeout(async () => {
            try {
              await interaction.editReply(buildView());
            } catch {}
          }, 1200);
          return;
        }

        await i.update(buildView());
      } catch (err) {
        console.error("[/vender] erro:", err);
        try {
          await i.reply({ content: "❌ Erro ao processar venda. Veja o console.", flags: 64 });
        } catch {}
      }
    });

    collector.on("end", async (_c, reason) => {
      if (reason === "closed" || reason === "empty") return;
      try {
        await interaction.editReply({ components: [] });
      } catch {
        // ignore
      }
    });
  }
};
