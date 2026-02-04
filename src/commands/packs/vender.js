import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder
} from "discord.js";
import mongoose from "mongoose";

import {
  Inventory,
  getInventoryCounts,
  hideLockedCounts,
  inventoryTotalCount
} from "../../packs/inventoryModel.js";
import { getCardPool } from "../../cards/cardsStore.js";
import { addBalance } from "../../economy/economyService.js";
import { emojiByRarity, formatCoins, rarityColor } from "../../ui/embeds.js";
import { getSquadLockedCounts } from "../../game/squad/squadService.js";
import { subtractLockedCounts } from "../../packs/inventoryModel.js";

const PAGE_SIZE = 25; // select menu limit
const INVENTORY_LIMIT = Math.max(1, Number(process.env.INVENTORY_LIMIT ?? 150) || 150);
const GLOBAL_SCOPE_GUILD_ID = "global";

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

  for (const [id, qtyRaw] of selected.entries()) {
    const it = itemsById.get(id);
    if (!it) continue;
    const qty = Math.max(0, Math.trunc(Number(qtyRaw ?? 0)));
    if (!qty) continue;
    stacks++;
    cards += qty;
    const val = Number(it.card?.value ?? 0);
    if (Number.isFinite(val) && val > 0) coins += val * qty;
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

function buildEmbed({ user, invTotal, items, selected, itemsById, page, totalPages, focusId }) {
  const sel = selectedSummary(selected, itemsById);

  const topColor =
    items[0]?.card?.rarity ? rarityColor(items[0].card.rarity) : 0x3498db;

  const selectedItems = Array.from(selected.entries())
    .map(([id, qty]) => ({ it: itemsById.get(id), qty: Math.max(0, Math.trunc(Number(qty ?? 0))) }))
    .filter((x) => x.it && x.qty > 0)
    .sort((a, b) => sortCards(a.it.card, b.it.card));

  const lines = [];
  if (!selectedItems.length) {
    lines.push("Nenhuma carta selecionada.");
    lines.push("");
    lines.push("Abra o menu abaixo para escolher cartas, ajuste a quantidade e depois clique **Vender seleção**.");
  } else {
    for (const { it, qty } of selectedItems.slice(0, 18)) {
      const ovr = typeof it.card?.ovr === "number" ? it.card.ovr : "??";
      const valEach = Number(it.card?.value ?? 0);
      const total = Number.isFinite(valEach) ? valEach * qty : 0;
      lines.push(
        `✅ ${emojiByRarity(it.card.rarity)} **${it.card.name}** (${it.card.pos}) • OVR **${ovr}** • vender **${qty}/${it.count}** • ${formatCoins(total)} 🪙`
      );
    }
    if (selectedItems.length > 18) lines.push(`… +${selectedItems.length - 18} stacks`);
  }

  let focusLine = "";
  if (focusId) {
    const it = itemsById.get(focusId);
    if (it) {
      const cur = Math.max(0, Math.trunc(Number(selected.get(focusId) ?? 0)));
      focusLine = `\n**Em foco:** ${emojiByRarity(it.card.rarity)} **${it.card.name}** • vender **${cur}/${it.count}**\n`;
    }
  }

  const desc =
    `Inventário (sem escalados): **${invTotal}/${INVENTORY_LIMIT}** cartas\n` +
    `Stacks: **${items.length}**\n\n` +
    `**Selecionado:** ${sel.stacks} stacks • ${sel.cards} cartas • **${formatCoins(sel.coins)} 🪙**\n` +
    focusLine +
    `\n` +
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
    .setPlaceholder("Selecionar uma carta para vender (ajuste a quantidade)…")
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
      .setLabel("Selecionar <90"),
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

function buildQtyButtons({ decId, inc1Id, inc5Id, maxId, removeId }, { disabled }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(decId).setStyle(ButtonStyle.Secondary).setLabel("−1").setDisabled(disabled),
    new ButtonBuilder().setCustomId(inc1Id).setStyle(ButtonStyle.Secondary).setLabel("+1").setDisabled(disabled),
    new ButtonBuilder().setCustomId(inc5Id).setStyle(ButtonStyle.Secondary).setLabel("+5").setDisabled(disabled),
    new ButtonBuilder().setCustomId(maxId).setStyle(ButtonStyle.Primary).setLabel("MAX").setDisabled(disabled),
    new ButtonBuilder().setCustomId(removeId).setStyle(ButtonStyle.Danger).setLabel("Remover").setDisabled(disabled)
  );
}

async function sellSelection({ guildId, userId, selected, itemsById, lockedCounts }) {
  if (mongoose.connection?.readyState !== 1) {
    throw new Error("MongoDB não conectado. Verifique MONGO_URI.");
  }

  const toSell = [];
  for (const [id, qtyRaw] of selected.entries()) {
    if (lockedCounts?.[id]) {
      throw new Error(`Tentou vender carta escalada (bloqueada): ${id}`);
    }
    const it = itemsById.get(id);
    if (!it) continue;
    const qty = Math.max(0, Math.trunc(Number(qtyRaw ?? 0)));
    const maxQty = Math.max(0, Math.trunc(Number(it.count ?? 0)));
    const sellQty = Math.min(qty, maxQty);
    if (!sellQty) continue;
    toSell.push({ cardId: id, count: sellQty, value: Number(it.card?.value ?? 0) || 0 });
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

    await Inventory.updateOne(
      { guildId: GLOBAL_SCOPE_GUILD_ID, userId },
      { $inc: inc },
      { upsert: true, session }
    );
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

    let lockedCounts = await getSquadLockedCounts(guildId, userId);
    let counts = await getInventoryCounts(guildId, userId);
    let availableCounts = hideLockedCounts(
      subtractLockedCounts(counts, lockedCounts),
      lockedCounts
    );
    let invTotal = inventoryTotalCount(availableCounts);

    let items = buildOwnedList(availableCounts, poolMap);
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
    const selected = new Map(); // cardId -> qty
    let focusId = null;
    let page = 1;

    const selectId = `sell_select:${interaction.id}`;
    const prevId = `sell_prev:${interaction.id}`;
    const nextId = `sell_next:${interaction.id}`;
    const selectAllId = `sell_all:${interaction.id}`;
    const clearId = `sell_clear:${interaction.id}`;
    const sellId = `sell_sell:${interaction.id}`;
    const closeId = `sell_close:${interaction.id}`;
    const decId = `sell_dec:${interaction.id}`;
    const inc1Id = `sell_inc1:${interaction.id}`;
    const inc5Id = `sell_inc5:${interaction.id}`;
    const maxId = `sell_max:${interaction.id}`;
    const removeId = `sell_remove:${interaction.id}`;

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
        totalPages: paged.totalPages,
        focusId
      });
      const qtyDisabled = !focusId || !itemsById.get(focusId);
      return {
        embeds: [embed],
        components: [
          buildSelect(selectId, paged.slice),
          buildQtyButtons({ decId, inc1Id, inc5Id, maxId, removeId }, { disabled: qtyDisabled }),
          buildNavButtons({ prevId, nextId, selectAllId, clearId, closeId }, { page: paged.safePage, totalPages: paged.totalPages }),
          buildSellButton(sellId, selected.size === 0)
        ]
      };
    }

    await interaction.editReply(buildView());
    const msg = await interaction.fetchReply();

    const filter = (i) =>
      i.user.id === interaction.user.id &&
      [selectId, prevId, nextId, selectAllId, clearId, sellId, closeId, decId, inc1Id, inc5Id, maxId, removeId].includes(i.customId);

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
          focusId = null;
        }

        if (i.customId === selectAllId) {
          for (const it of items) {
            const ovr = typeof it.card?.ovr === "number" ? it.card.ovr : 0;
            if (ovr >= 90) continue;
            const cur = Math.max(0, Math.trunc(Number(selected.get(it.cardId) ?? 0)));
            if (it.count > cur) selected.set(it.cardId, it.count);
          }
        }

        if (i.customId === selectId) {
          const picked = i.values?.[0];
          if (picked && picked !== "none") {
            focusId = picked;
            const it = itemsById.get(picked);
            const maxQty = Math.max(0, Math.trunc(Number(it?.count ?? 0)));
            const cur = Math.max(0, Math.trunc(Number(selected.get(picked) ?? 0)));
            if (maxQty > 0) selected.set(picked, Math.min(maxQty, cur + 1));
          }
        }

        if ([decId, inc1Id, inc5Id, maxId, removeId].includes(i.customId)) {
          if (!focusId) {
            await i.update(buildView());
            return;
          }
          const it = itemsById.get(focusId);
          if (!it) {
            focusId = null;
            await i.update(buildView());
            return;
          }

          const maxQty = Math.max(0, Math.trunc(Number(it.count ?? 0)));
          const cur = Math.max(0, Math.trunc(Number(selected.get(focusId) ?? 0)));
          let nextQty = cur;

          if (i.customId === decId) nextQty = Math.max(0, cur - 1);
          if (i.customId === inc1Id) nextQty = Math.min(maxQty, cur + 1);
          if (i.customId === inc5Id) nextQty = Math.min(maxQty, cur + 5);
          if (i.customId === maxId) nextQty = maxQty;
          if (i.customId === removeId) nextQty = 0;

          if (nextQty > 0) selected.set(focusId, nextQty);
          else selected.delete(focusId);
        }

        if (i.customId === sellId) {
          if (!selected.size) {
            await i.update(buildView());
            return;
          }

          const before = selectedSummary(selected, itemsById);
          const sold = await sellSelection({ guildId, userId, selected, itemsById, lockedCounts });
          selected.clear();
          focusId = null;

          lockedCounts = await getSquadLockedCounts(guildId, userId);
          counts = await getInventoryCounts(guildId, userId);
          availableCounts = hideLockedCounts(
            subtractLockedCounts(counts, lockedCounts),
            lockedCounts
          );
          invTotal = inventoryTotalCount(availableCounts);
          items = buildOwnedList(availableCounts, poolMap);
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
