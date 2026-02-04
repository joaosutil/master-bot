import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} from "discord.js";
import mongoose from "mongoose";

import { PACKS, PACK_LIST } from "./packCatalog.js";
import {
  addPackToStash,
  consumePackFromStash,
  getPackCounts
} from "./packStash.js";
import { generatePackCards } from "./packEngine.js";

import { getBalance as getEcoBalance, trySpendBalance } from "../../economy/economyService.js";
import { addCardsToInventory } from "../../packs/inventoryModel.js";
import { getInventoryCounts, inventoryTotalCount } from "../../packs/inventoryModel.js";

import { renderPackRevealPng } from "../../ui/renderPackReveal.js";
import { renderPackOpeningPng } from "../../ui/renderPackOpening.js";
import { renderPackArtPng } from "../../ui/renderPackArt.js";
import { renderPackStashBannerPng } from "../../ui/renderPackStashBanner.js";
import { renderWalkoutScenePng } from "../../ui/renderWalkoutScene.js";
import { formatCoins } from "../../ui/embeds.js";

const DEFAULT_PACK_ID = "bronze";
const INVENTORY_LIMIT = Math.max(1, Number(process.env.INVENTORY_LIMIT ?? 150) || 150);

function packCardCount(pack) {
  return (pack?.slots ?? []).reduce((acc, s) => acc + (Number(s?.count ?? 0) || 0), 0);
}

async function getBalance({ guildId, userId }) {
  return await getEcoBalance(guildId, userId);
}

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

function rarityRank(r) {
  if (r === "legendary") return 4;
  if (r === "epic") return 3;
  if (r === "rare") return 2;
  return 1;
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

function rarityEmoji(r) {
  if (r === "legendary") return "🌟";
  if (r === "epic") return "🟣";
  if (r === "rare") return "🔵";
  return "⚪";
}

function rarityLabel(r) {
  if (r === "legendary") return "Lendária";
  if (r === "epic") return "Épica";
  if (r === "rare") return "Rara";
  return "Comum";
}

function formatOdds(odds = {}) {
  const entries = Object.entries(odds);
  const sum = entries.reduce((acc, [, w]) => acc + Number(w || 0), 0) || 1;
  return entries
    .map(([rar, w]) => {
      const pct = Math.round((Number(w || 0) / sum) * 100);
      return `${rarityEmoji(rar)} ${rarityLabel(rar)}: **${pct}%**`;
    })
    .join(" | ");
}

function shopEmbed({ balance, counts }) {
  return new EmbedBuilder()
    .setTitle("🎴 Packs • Loja & Estoque")
    .setColor("#7c3aed")
    .setDescription(
      [
        "Compre packs, guarde no estoque e abra quando quiser.",
        "Dica: selecione um pack abaixo para ver detalhes e abrir direto."
      ].join("\n")
    )
    .addFields(
      ...PACK_LIST.map((p) => {
        const owned = counts?.[p.id] ?? 0;
        return {
          name: `${p.emoji} ${p.name}`,
          value: `**${owned}x** no estoque\n${formatCoins(p.price)} 🪙`,
          inline: true
        };
      })
    )
    .setFooter({ text: `Seu saldo: ${formatCoins(balance)} 🪙` });
}

async function stashBannerFile({ userTag, counts }) {
  const fileName = `packs-${Date.now()}.png`;
  const buf = await renderPackStashBannerPng({
    title: "Mochila de Packs",
    subtitle: userTag ? String(userTag).split("#")[0] : "",
    packs: PACK_LIST.map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      accent: packAccent(p.id)
    })),
    counts,
    accent: "#7c3aed"
  });
  return { fileName, attachment: new AttachmentBuilder(buf, { name: fileName }) };
}

function packEmbed({ pack, balance, owned }) {
  return new EmbedBuilder()
    .setTitle(`${pack.emoji} ${pack.name}`)
    .setColor(packAccent(pack.id))
    .setDescription(
      [
        pack.description,
        "",
        `**Preço:** ${formatCoins(pack.price)} 🪙`,
        `**No seu estoque:** **${owned}x**`
      ].join("\n")
    )
    .addFields({
      name: "📦 Chances (por carta)",
      value: pack.slots
        .map((s) => {
          return `• **${s.count}x** (${formatOdds(s.odds)})`;
        })
        .join("\n")
    })
    .setFooter({ text: `Saldo: ${formatCoins(balance)} 🪙` });
}

async function packArtFile(pack) {
  const fileName = `pack-${pack.id}.png`;
  const buf = renderPackArtPng({
    packId: pack.id,
    name: pack.name,
    emoji: pack.emoji,
    accent: packAccent(pack.id)
  });
  return {
    fileName,
    attachment: new AttachmentBuilder(buf, { name: fileName })
  };
}

async function buildHubView({ userTag, pack, balance, counts, descriptionOverride } = {}) {
  const owned = counts?.[pack.id] ?? 0;

  const banner = await stashBannerFile({ userTag, counts });
  const shop = shopEmbed({ balance, counts }).setImage(`attachment://${banner.fileName}`);

  const { fileName: packArtName, attachment: packArtAttachment } = await packArtFile(pack);
  const details = packEmbed({ pack, balance, owned }).setThumbnail(`attachment://${packArtName}`);
  if (descriptionOverride) details.setDescription(descriptionOverride);

  return {
    embeds: [shop, details],
    files: [banner.attachment, packArtAttachment]
  };
}

function selectMenu({ userId }) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`pack_select:${userId}`)
      .setPlaceholder("Escolha um pack…")
      .addOptions(
        PACK_LIST.map((p) => ({
          label: `${p.name} (${formatCoins(p.price)})`,
          value: p.id,
          description: p.description.slice(0, 90),
          emoji: p.emoji
        }))
      )
  );
}

function actionButtons({ userId, packId, owned }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pack_buy:${userId}:${packId}:1`)
      .setLabel("Comprar x1")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`pack_buy:${userId}:${packId}:5`)
      .setLabel("Comprar x5")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`pack_buy:${userId}:${packId}:10`)
      .setLabel("Comprar x10")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`pack_open:${userId}:${packId}:1`)
      .setLabel("Abrir x1")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!owned || owned <= 0),
    new ButtonBuilder()
      .setCustomId(`pack_open:${userId}:${packId}:5`)
      .setLabel("Abrir x5")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!owned || owned < 5)
  );
}

function utilityButtons({ userId, packId }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pack_refresh:${userId}:${packId}`)
      .setLabel("Atualizar")
      .setStyle(ButtonStyle.Secondary)
  );
}

function resultButtons({ userId, packId, owned }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pack_open:${userId}:${packId}:1`)
      .setLabel("Abrir novamente x1")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!owned || owned <= 0),
    new ButtonBuilder()
      .setCustomId(`pack_open:${userId}:${packId}:5`)
      .setLabel("Abrir novamente x5")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!owned || owned < 5),
    new ButtonBuilder()
      .setCustomId(`pack_back:${userId}:${packId}`)
      .setLabel("Voltar")
      .setStyle(ButtonStyle.Secondary)
  );
}

export async function showPackShop(interaction) {
  const balance = await getBalance({ guildId: interaction.guildId, userId: interaction.user.id });
  const counts = await getPackCounts(interaction.guildId, interaction.user.id);
  const pack = PACKS[DEFAULT_PACK_ID] ?? PACK_LIST[0];
  const view = await buildHubView({
    userTag: interaction.user?.tag,
    pack,
    balance,
    counts
  });
  const owned = counts?.[pack.id] ?? 0;

  await interaction.reply({
    ephemeral: true,
    embeds: view.embeds,
    files: view.files,
    components: [
      selectMenu({ userId: interaction.user.id }),
      actionButtons({ userId: interaction.user.id, packId: pack.id, owned }),
      utilityButtons({ userId: interaction.user.id, packId: pack.id })
    ]
  });
}

export async function handlePackSelect(interaction) {
  const [, ownerId] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: "Esse menu não é seu 😅", ephemeral: true });
  }

  const packId = interaction.values?.[0];
  const pack = PACKS[packId];
  if (!pack) return interaction.reply({ content: "Pack inválido.", ephemeral: true });

  const balance = await getBalance({ guildId: interaction.guildId, userId: interaction.user.id });
  const counts = await getPackCounts(interaction.guildId, interaction.user.id);
  const owned = counts?.[pack.id] ?? 0;

  const view = await buildHubView({
    userTag: interaction.user?.tag,
    pack,
    balance,
    counts
  });
  await interaction.update({
    embeds: view.embeds,
    files: view.files,
    components: [
      selectMenu({ userId: ownerId }),
      actionButtons({ userId: ownerId, packId: pack.id, owned }),
      utilityButtons({ userId: ownerId, packId: pack.id })
    ]
  });
}

export async function handlePackButton(interaction) {
  const parts = interaction.customId.split(":");
  const action = parts[0]; // pack_buy | pack_open | pack_refresh | pack_back
  const ownerId = parts[1];
  const packId = parts[2];
  const qty = Number(parts[3] || "1");

  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: "Esse botão não é seu 😅", ephemeral: true });
  }

  try {
    if (action === "pack_back") {
      const pack = PACKS[packId] ?? PACKS[DEFAULT_PACK_ID] ?? PACK_LIST[0];
      if (!pack) return interaction.reply({ content: "Pack inválido.", ephemeral: true });

      const balance = await getBalance({ guildId: interaction.guildId, userId: interaction.user.id });
      const counts = await getPackCounts(interaction.guildId, interaction.user.id);
      const owned = counts?.[pack.id] ?? 0;

      const view = await buildHubView({
        userTag: interaction.user?.tag,
        pack,
        balance,
        counts
      });

      return interaction.update({
        embeds: view.embeds,
        files: view.files,
        components: [
          selectMenu({ userId: ownerId }),
          actionButtons({ userId: ownerId, packId: pack.id, owned }),
          utilityButtons({ userId: ownerId, packId: pack.id })
        ]
      });
    }

    if (action === "pack_refresh") {
      const pack = PACKS[packId];
      if (!pack) return interaction.reply({ content: "Pack inválido.", ephemeral: true });

      const balance = await getBalance({ guildId: interaction.guildId, userId: interaction.user.id });
      const counts = await getPackCounts(interaction.guildId, interaction.user.id);
      const owned = counts?.[pack.id] ?? 0;

      const view = await buildHubView({
        userTag: interaction.user?.tag,
        pack,
        balance,
        counts
      });
      return interaction.update({
        embeds: view.embeds,
        files: view.files,
        components: [
          selectMenu({ userId: ownerId }),
          actionButtons({ userId: ownerId, packId: pack.id, owned }),
          utilityButtons({ userId: ownerId, packId: pack.id })
        ]
      });
    }

    await interaction.deferUpdate();

    if (action === "pack_buy") {
      const pack = PACKS[packId];
      if (!pack) return;

      const totalCost = pack.price * qty;

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const spent = await trySpendBalance(interaction.guildId, interaction.user.id, totalCost, session);
        if (!spent.ok) {
          await session.abortTransaction();

          const countsBefore = await getPackCounts(interaction.guildId, interaction.user.id);
          const ownedBefore = countsBefore?.[pack.id] ?? 0;

          const desc = `${pack.description}\n\n❌ Saldo insuficiente para **${qty}x** (custo ${formatCoins(totalCost)} 🪙).`;
          const view = await buildHubView({
            userTag: interaction.user?.tag,
            pack,
            balance: spent.balance,
            counts: countsBefore,
            descriptionOverride: desc
          });
          return interaction.editReply({
            embeds: view.embeds,
            files: view.files,
            components: [
              selectMenu({ userId: ownerId }),
              actionButtons({ userId: ownerId, packId: pack.id, owned: ownedBefore }),
              utilityButtons({ userId: ownerId, packId: pack.id })
            ]
          });
        }

        await addPackToStash(interaction.guildId, interaction.user.id, packId, qty, { session });
        await session.commitTransaction();

        const countsAfter = await getPackCounts(interaction.guildId, interaction.user.id);
        const ownedAfter = countsAfter?.[pack.id] ?? 0;

        const desc = `${pack.description}\n\n✅ Comprado **${qty}x**.\n**Agora no estoque:** **${ownedAfter}x**`;
        const view = await buildHubView({
          userTag: interaction.user?.tag,
          pack,
          balance: spent.balance,
          counts: countsAfter,
          descriptionOverride: desc
        });

        return interaction.editReply({
          embeds: view.embeds,
          files: view.files,
          components: [
            selectMenu({ userId: ownerId }),
            actionButtons({ userId: ownerId, packId: pack.id, owned: ownedAfter }),
            utilityButtons({ userId: ownerId, packId: pack.id })
          ]
        });
      } finally {
        session.endSession();
      }
    }

    if (action === "pack_open") {
      const pack = PACKS[packId];
      if (!pack) return;

      const openQty = Number.isFinite(qty) && qty > 1 ? Math.floor(qty) : 1;
      const invCounts = await getInventoryCounts(interaction.guildId, interaction.user.id);
      const invTotal = inventoryTotalCount(invCounts);
      const willAdd = packCardCount(pack) * openQty;
      const after = invTotal + willAdd;

      if (after > INVENTORY_LIMIT) {
        const balance = await getBalance({ guildId: interaction.guildId, userId: interaction.user.id });
        const counts = await getPackCounts(interaction.guildId, interaction.user.id);
        const owned = counts?.[pack.id] ?? 0;

        const desc =
          `${pack.description}\n\n` +
          `❌ **Time Cheio**: seu inventário está com **${invTotal}/${INVENTORY_LIMIT}** cartas.\n` +
          `Abrir **${openQty}x** adicionaria **${willAdd}** cartas (ficaria **${after}/${INVENTORY_LIMIT}**).\n\n` +
          `Use **/vender** para liberar espaço (o botão "Selecionar tudo" não marca cartas 90+ automaticamente).`;

        const view = await buildHubView({
          userTag: interaction.user?.tag,
          pack,
          balance,
          counts,
          descriptionOverride: desc
        });

        return interaction.editReply({
          embeds: view.embeds,
          files: view.files,
          components: [
            selectMenu({ userId: ownerId }),
            actionButtons({ userId: ownerId, packId: pack.id, owned }),
            utilityButtons({ userId: ownerId, packId: pack.id })
          ]
        });
      }

      const session = await mongoose.startSession();
      session.startTransaction();

      let pulled = [];
      try {
        const consumed = await consumePackFromStash(interaction.guildId, interaction.user.id, packId, openQty, { session });
        if (!consumed.ok) {
          await session.abortTransaction();

          const balance = await getBalance({ guildId: interaction.guildId, userId: interaction.user.id });
          const counts = await getPackCounts(interaction.guildId, interaction.user.id);
          const owned = counts?.[pack.id] ?? 0;

          const desc = `${pack.description}\n\n❌ Você não tem esse pack no estoque.`;
          const view = await buildHubView({
            userTag: interaction.user?.tag,
            pack,
            balance,
            counts,
            descriptionOverride: desc
          });

          return interaction.editReply({
            embeds: view.embeds,
            files: view.files,
            components: [
              selectMenu({ userId: ownerId }),
              actionButtons({ userId: ownerId, packId: pack.id, owned }),
              utilityButtons({ userId: ownerId, packId: pack.id })
            ]
          });
        }

        for (let i = 0; i < openQty; i++) {
          const cards = await generatePackCards(packId);
          pulled.push(...cards);
        }
        await addCardsToInventory(interaction.guildId, interaction.user.id, pulled, { session });

        await session.commitTransaction();
      } finally {
        session.endSession();
      }

      const opening = await renderPackOpeningPng({
        packId,
        name: pack.name,
        emoji: pack.emoji,
        accent: packAccent(packId)
      });
      const openingFileName = `opening-${packId}-${Date.now()}.png`;
      const openingAttachment = new AttachmentBuilder(opening, { name: openingFileName });

      const openingEmbed = new EmbedBuilder()
        .setTitle(`✨ Abrindo ${pack.emoji} ${pack.name}…`)
        .setColor(packAccent(packId))
        .setImage(`attachment://${openingFileName}`);

      await interaction.editReply({ embeds: [openingEmbed], files: [openingAttachment], components: [] });
      await sleep(850);

      const top = bestCard(pulled);
      const topOvr = typeof top?.ovr === "number" ? top.ovr : 0;
      if (top && (top.rarity === "epic" || top.rarity === "legendary" || topOvr >= 90)) {
        const topPng = await renderWalkoutScenePng({
          card: top,
          title: "WALKOUT",
          subtitle: pack.name,
          badge: `${topOvr} OVR`
        });
        const topFileName = `walkout-${top.id}-${Date.now()}.png`;
        const topAttachment = new AttachmentBuilder(topPng, { name: topFileName });

        const walkout = new EmbedBuilder()
          .setTitle(`🔥 WALKOUT! ${rarityEmoji(top.rarity)} ${top.name}`)
          .setColor(rarityAccent(top.rarity))
          .setImage(`attachment://${topFileName}`);

        await interaction.editReply({ embeds: [walkout], files: [topAttachment], components: [] });
        await sleep(1200);
      }

      const banner = await renderPackRevealPng({
        cards: pulled,
        title: pack.name,
        qty: pulled.length,
        accent: top ? rarityAccent(top.rarity) : packAccent(packId)
      });

      const fileName = `reveal-${packId}-${Date.now()}.png`;
      const attachment = new AttachmentBuilder(banner, { name: fileName });

      const listLines = pulled.slice(0, 30).map((c) => {
        const ovr = typeof c.ovr === "number" ? c.ovr : "??";
        const val = typeof c.value === "number" ? `${formatCoins(c.value)} 🪙` : "—";
        return `${rarityEmoji(c.rarity)} **${c.name}** • OVR **${ovr}** • ${val}`;
      });
      const list = listLines.join("\n") + (pulled.length > 30 ? `\n… +${pulled.length - 30} cartas` : "");

      const balance = await getBalance({ guildId: interaction.guildId, userId: interaction.user.id });
      const counts = await getPackCounts(interaction.guildId, interaction.user.id);
      const owned = counts?.[packId] ?? 0;

      const e = new EmbedBuilder()
        .setTitle(`🎴 ${pack.emoji} ${pack.name} aberto!`)
        .setColor(top ? rarityAccent(top.rarity) : packAccent(packId))
        .setDescription(list)
        .setImage(`attachment://${fileName}`)
        .setFooter({ text: `Restam no estoque: ${owned}x • Saldo: ${formatCoins(balance)} 🪙` });

      return interaction.editReply({
        embeds: [e],
        files: [attachment],
        components: [
          resultButtons({ userId: ownerId, packId: pack.id, owned })
        ]
      });
    }
  } catch (err) {
    console.error("PACK UI ERROR:", err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: "Deu erro ao processar o pack. Veja o console." });
      } else {
        await interaction.reply({ content: "Deu erro ao processar o pack. Veja o console.", ephemeral: true });
      }
    } catch {}
  }
}
