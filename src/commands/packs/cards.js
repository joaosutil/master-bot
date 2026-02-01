import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} from "discord.js";
import { economyEmbed, rarityLabel, rarityColor, emojiByRarity } from "../../ui/embeds.js";
import { getCardPool } from "../../cards/cardsStore.js";

const PAGE_SIZE = 12;

function rarityRank(r) {
  if (r === "legendary") return 4;
  if (r === "epic") return 3;
  if (r === "rare") return 2;
  return 1;
}

function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function filterAndSort(pool, { rarity, search }) {
  let arr = [...pool];

  if (rarity && rarity !== "all") arr = arr.filter((c) => c.rarity === rarity);
  if (search) {
    const q = normalize(search);
    arr = arr.filter((c) => normalize(c.name).includes(q));
  }

  arr.sort((a, b) => {
    const ra = rarityRank(a.rarity);
    const rb = rarityRank(b.rarity);
    if (rb !== ra) return rb - ra;

    const oa = typeof a.ovr === "number" ? a.ovr : -1;
    const ob = typeof b.ovr === "number" ? b.ovr : -1;
    if (ob !== oa) return ob - oa;

    return String(a.name).localeCompare(String(b.name), "pt-BR");
  });

  return arr;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function buildPageEmbed(cards, page, { rarity, search }) {
  const total = cards.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = clamp(page, 1, totalPages);

  const start = (safePage - 1) * PAGE_SIZE;
  const slice = cards.slice(start, start + PAGE_SIZE);

  const filters = [
    rarity && rarity !== "all" ? `Raridade: **${rarityLabel(rarity)}**` : "Raridade: **Todas**",
    search ? `Busca: **"${search}"**` : null
  ].filter(Boolean);

  const lines = slice.map((c, i) => {
    const idx = start + i + 1;
    const ovr = typeof c.ovr === "number" ? c.ovr : "??";
    const pos = c.pos ?? "??";
    return `${idx}. ${emojiByRarity(c.rarity)} **${c.name}** (${pos}) • OVR **${ovr}** • \`${c.id}\``;
  });

  const desc = `${filters.join(" • ")}\n\n${lines.length ? lines.join("\n") : "Nenhuma carta encontrada."}`;

  const color = rarity && rarity !== "all" ? rarityColor(rarity) : 0x3498db;

  const embed = economyEmbed({
    title: "📚 Cartas do Bot",
    description: desc,
    color,
    footer: `Página ${safePage}/${totalPages} • Total: ${total} • Dica: /card <ID>`
  });

  return { embed, safePage, totalPages };
}

function buildSelect(customId, rarity) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("Filtrar raridade…")
      .addOptions(
        { label: "Todas", value: "all", default: rarity === "all" },
        { label: "Comum", value: "common", default: rarity === "common" },
        { label: "Rara", value: "rare", default: rarity === "rare" },
        { label: "Épica", value: "epic", default: rarity === "epic" },
        { label: "Lendária", value: "legendary", default: rarity === "legendary" }
      )
  );
}

function buildButtons({ prevId, nextId, closeId }, { page, totalPages }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(prevId)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("⬅️ Anterior")
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(nextId)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Próxima ➡️")
      .setDisabled(page >= totalPages),
    new ButtonBuilder()
      .setCustomId(closeId)
      .setStyle(ButtonStyle.Danger)
      .setLabel("Fechar ✖️")
  );
}

const data = new SlashCommandBuilder()
  .setName("cards")
  .setDescription("Lista as cartas (filtro por raridade + páginas)")
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt.setName("busca").setDescription("Buscar pelo nome (ex: neymar, pele)")
  )
  .addIntegerOption((opt) =>
    opt.setName("pagina").setDescription("Começar em uma página").setMinValue(1)
  )
  .addBooleanOption((opt) =>
    opt.setName("publico").setDescription("Se true, envia no chat")
  );

export default {
  data,
  async execute(interaction) {
    const search = interaction.options.getString("busca");
    const pageStart = interaction.options.getInteger("pagina") ?? 1;
    const publico = interaction.options.getBoolean("publico") ?? false;

    const pool = await getCardPool();

    let rarity = "all";
    let page = pageStart;

    const selectId = `cards_rarity:${interaction.id}`;
    const prevId = `cards_prev:${interaction.id}`;
    const nextId = `cards_next:${interaction.id}`;
    const closeId = `cards_close:${interaction.id}`;

    let filtered = filterAndSort(pool, { rarity, search });

    const built = buildPageEmbed(filtered, page, { rarity, search });
    page = built.safePage;

    await interaction.reply({
      embeds: [built.embed],
      components: [
        buildSelect(selectId, rarity),
        buildButtons({ prevId, nextId, closeId }, { page, totalPages: built.totalPages })
      ],
      ephemeral: !publico
    });

    const msg = await interaction.fetchReply();

    const filter = (i) =>
      i.user.id === interaction.user.id &&
      [selectId, prevId, nextId, closeId].includes(i.customId);

    const collector = msg.createMessageComponentCollector({
      filter,
      time: 120_000
    });

    collector.on("collect", async (i) => {
      if (i.customId === closeId) {
        collector.stop("closed");
        await i.update({
          embeds: [
            economyEmbed({
              title: "✅ Fechado",
              description: "Lista fechada.",
              color: 0x95a5a6
            })
          ],
          components: []
        });
        return;
      }

      if (i.customId === selectId) {
        rarity = i.values?.[0] ?? "all";
        page = 1;
      }

      if (i.customId === prevId) page -= 1;
      if (i.customId === nextId) page += 1;

      filtered = filterAndSort(pool, { rarity, search });

      const rebuilt = buildPageEmbed(filtered, page, { rarity, search });
      page = rebuilt.safePage;

      await i.update({
        embeds: [rebuilt.embed],
        components: [
          buildSelect(selectId, rarity),
          buildButtons({ prevId, nextId, closeId }, { page, totalPages: rebuilt.totalPages })
        ]
      });
    });

    collector.on("end", async (_c, reason) => {
      if (reason === "closed") return;
      try {
        await interaction.editReply({ components: [] });
      } catch {
        // ignore
      }
    });
  }
};

