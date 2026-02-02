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

import { renderPackRevealPng } from "../../ui/renderPackReveal.js";
import { renderCardPng } from "../../ui/renderCard.js";
import { renderPackOpeningPng } from "../../ui/renderPackOpening.js";
import { renderPackArtPng } from "../../ui/renderPackArt.js";
import { renderPackStashBannerPng } from "../../ui/renderPackStashBanner.js";
import { formatCoins } from "../../ui/embeds.js";

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
    .setTitle("🎴 Mochila de Packs")
    .setColor("#7c3aed")
    .setDescription("Compre packs, guarde no estoque e abra quando quiser.")
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
    .setDescription(`${pack.description}\n\n**Preço:** ${formatCoins(pack.price)} 🪙\n**No seu estoque:** **${owned}x**`)
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

async function buildPackView({ pack, balance, owned, descriptionOverride } = {}) {
  const { fileName, attachment } = await packArtFile(pack);
  const e = packEmbed({ pack, balance, owned });
  e.setThumbnail(`attachment://${fileName}`);
  if (descriptionOverride) e.setDescription(descriptionOverride);
  return { embed: e, files: [attachment] };
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

function buyButtons({ userId, packId }) {
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
      .setCustomId(`pack_back:${userId}`)
      .setLabel("Voltar")
      .setStyle(ButtonStyle.Danger)
  );
}

function openButtons({ userId, packId, owned }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pack_open:${userId}:${packId}`)
      .setLabel("Abrir 1 do estoque")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!owned || owned <= 0),
    new ButtonBuilder()
      .setCustomId(`pack_refresh:${userId}:${packId}`)
      .setLabel("Atualizar")
      .setStyle(ButtonStyle.Secondary)
  );
}

export async function showPackShop(interaction) {
  const balance = await getBalance({ guildId: interaction.guildId, userId: interaction.user.id });
  const counts = await getPackCounts(interaction.guildId, interaction.user.id);
  const banner = await stashBannerFile({ userTag: interaction.user?.tag, counts });
  const embed = shopEmbed({ balance, counts });
  embed.setImage(`attachment://${banner.fileName}`);

  await interaction.reply({
    ephemeral: true,
    embeds: [embed],
    files: [banner.attachment],
    components: [selectMenu({ userId: interaction.user.id })]
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
  const owned = counts?.[packId] ?? 0;

  const view = await buildPackView({ pack, balance, owned });
  await interaction.update({
    embeds: [view.embed],
    files: view.files,
    components: [
      selectMenu({ userId: ownerId }),
      buyButtons({ userId: ownerId, packId }),
      openButtons({ userId: ownerId, packId, owned })
    ]
  });
}

export async function handlePackButton(interaction) {
  const parts = interaction.customId.split(":");
  const action = parts[0]; // pack_buy | pack_back | pack_open | pack_refresh
  const ownerId = parts[1];
  const packId = parts[2];
  const qty = Number(parts[3] || "1");

  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: "Esse botão não é seu 😅", ephemeral: true });
  }

  try {
    if (action === "pack_back") {
      const balance = await getBalance({ guildId: interaction.guildId, userId: interaction.user.id });
      const counts = await getPackCounts(interaction.guildId, interaction.user.id);
      const banner = await stashBannerFile({ userTag: interaction.user?.tag, counts });
      const embed = shopEmbed({ balance, counts });
      embed.setImage(`attachment://${banner.fileName}`);
      return interaction.update({
        embeds: [embed],
        files: [banner.attachment],
        components: [selectMenu({ userId: ownerId })]
      });
    }

    if (action === "pack_refresh") {
      const pack = PACKS[packId];
      if (!pack) return interaction.reply({ content: "Pack inválido.", ephemeral: true });

      const balance = await getBalance({ guildId: interaction.guildId, userId: interaction.user.id });
      const counts = await getPackCounts(interaction.guildId, interaction.user.id);
      const owned = counts?.[packId] ?? 0;

      const view = await buildPackView({ pack, balance, owned });
      return interaction.update({
        embeds: [view.embed],
        files: view.files,
        components: [
          selectMenu({ userId: ownerId }),
          buyButtons({ userId: ownerId, packId }),
          openButtons({ userId: ownerId, packId, owned })
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
          const ownedBefore = countsBefore?.[packId] ?? 0;

          const desc = `${pack.description}\n\n❌ Saldo insuficiente para **${qty}x** (custo ${formatCoins(totalCost)} 🪙).`;
          const view = await buildPackView({ pack, balance: spent.balance, owned: ownedBefore, descriptionOverride: desc });
          return interaction.editReply({
            embeds: [view.embed],
            files: view.files,
            components: [
              selectMenu({ userId: ownerId }),
              buyButtons({ userId: ownerId, packId }),
              openButtons({ userId: ownerId, packId, owned: ownedBefore })
            ]
          });
        }

        await addPackToStash(interaction.guildId, interaction.user.id, packId, qty, { session });
        await session.commitTransaction();

        const countsAfter = await getPackCounts(interaction.guildId, interaction.user.id);
        const ownedAfter = countsAfter?.[packId] ?? 0;

      const desc = `${pack.description}\n\n✅ Comprado **${qty}x**.\n**Agora no estoque:** **${ownedAfter}x**`;
      const view = await buildPackView({ pack, balance: spent.balance, owned: ownedAfter, descriptionOverride: desc });

        return interaction.editReply({
          embeds: [view.embed],
          files: view.files,
          components: [
            selectMenu({ userId: ownerId }),
            buyButtons({ userId: ownerId, packId }),
            openButtons({ userId: ownerId, packId, owned: ownedAfter })
          ]
        });
      } finally {
        session.endSession();
      }
    }

    if (action === "pack_open") {
      const pack = PACKS[packId];
      if (!pack) return;

      const session = await mongoose.startSession();
      session.startTransaction();

      let pulled = [];
      try {
        const consumed = await consumePackFromStash(interaction.guildId, interaction.user.id, packId, 1, { session });
        if (!consumed.ok) {
          await session.abortTransaction();

          const balance = await getBalance({ guildId: interaction.guildId, userId: interaction.user.id });
          const counts = await getPackCounts(interaction.guildId, interaction.user.id);
          const owned = counts?.[packId] ?? 0;

          const desc = `${pack.description}\n\n❌ Você não tem esse pack no estoque.`;
          const view = await buildPackView({ pack, balance, owned, descriptionOverride: desc });

          return interaction.editReply({
            embeds: [view.embed],
            files: view.files,
            components: [
              selectMenu({ userId: ownerId }),
              buyButtons({ userId: ownerId, packId }),
              openButtons({ userId: ownerId, packId, owned })
            ]
          });
        }

        pulled = await generatePackCards(packId);
        await addCardsToInventory(interaction.guildId, interaction.user.id, pulled, { session });

        await session.commitTransaction();
      } finally {
        session.endSession();
      }

      const opening = await renderPackOpeningPng({ packId, name: pack.name, emoji: pack.emoji, accent: packAccent(packId) });
      const openingFileName = `opening-${packId}-${Date.now()}.png`;
      const openingAttachment = new AttachmentBuilder(opening, { name: openingFileName });

      const openingEmbed = new EmbedBuilder()
        .setTitle(`✨ Abrindo ${pack.emoji} ${pack.name}…`)
        .setColor(packAccent(packId))
        .setImage(`attachment://${openingFileName}`);

      await interaction.editReply({ embeds: [openingEmbed], files: [openingAttachment], components: [] });
      await sleep(850);

      const top = bestCard(pulled);
      if (top && (top.rarity === "epic" || top.rarity === "legendary")) {
        const topPng = await renderCardPng(top);
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

      const list = pulled
        .map((c) => {
          const ovr = typeof c.ovr === "number" ? c.ovr : "??";
          const val = typeof c.value === "number" ? `${formatCoins(c.value)} 🪙` : "—";
          return `${rarityEmoji(c.rarity)} **${c.name}** • OVR **${ovr}** • ${val}`;
        })
        .join("\n");

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
          selectMenu({ userId: ownerId }),
          buyButtons({ userId: ownerId, packId }),
          openButtons({ userId: ownerId, packId, owned })
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
