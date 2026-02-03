import { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  autoSquad,
  clearSquad,
  hydrateSquad,
  removeSquadSlot,
  setFormation,
  setSquadSlot
} from "../../game/squad/squadService.js";
import { renderSquadPng } from "../../ui/renderSquad.js";

const FORMATION_CHOICES = [{ name: "4-3-3", value: "4-3-3" }];

const SLOT_CHOICES = [
  { name: "GOL", value: "GK" },
  { name: "LE", value: "LB" },
  { name: "ZAG 1", value: "CB1" },
  { name: "ZAG 2", value: "CB2" },
  { name: "LD", value: "RB" },
  { name: "MC 1", value: "CM1" },
  { name: "MEI", value: "CM2" },
  { name: "MC 2", value: "CM3" },
  { name: "PE", value: "LW" },
  { name: "ATA", value: "ST" },
  { name: "PD", value: "RW" }
];

function rarityEmoji(r) {
  if (r === "legendary") return "🌟";
  if (r === "epic") return "🟣";
  if (r === "rare") return "🔷";
  return "⚪";
}

function buildLineupText(lineup) {
  const lines = [];
  for (const it of lineup) {
    if (!it.card) {
      lines.push(`• **${it.slot.label}**: *(vazio)*`);
      continue;
    }

    const ovr = typeof it.card.ovr === "number" ? it.card.ovr : "??";
    lines.push(`• **${it.slot.label}**: ${rarityEmoji(it.card.rarity)} **${it.card.name}** • OVR **${ovr}**`);
  }

  // limite discord
  if (lines.join("\n").length > 3500) {
    return lines.slice(0, 20).join("\n") + "\n…";
  }
  return lines.join("\n");
}

const data = new SlashCommandBuilder()
  .setName("escalar")
  .setDescription("Monta seu time (auto ou manual) usando suas cartas")
  .setDMPermission(false)
  .addSubcommand((sc) =>
    sc
      .setName("ver")
      .setDescription("Mostra seu time atual")
      .addBooleanOption((o) => o.setName("publico").setDescription("Se true, envia no chat"))
  )
  .addSubcommand((sc) =>
    sc
      .setName("formacao")
      .setDescription("Escolhe a formação")
      .addStringOption((o) =>
        o
          .setName("valor")
          .setDescription("Formação")
          .setRequired(true)
          .addChoices(...FORMATION_CHOICES)
      )
      .addBooleanOption((o) => o.setName("publico").setDescription("Se true, envia no chat"))
  )
  .addSubcommand((sc) =>
    sc
      .setName("set")
      .setDescription("Define uma carta em uma posição do time")
      .addStringOption((o) =>
        o
          .setName("posicao")
          .setDescription("Posição/slot")
          .setRequired(true)
          .addChoices(...SLOT_CHOICES)
      )
      .addStringOption((o) =>
        o
          .setName("carta")
          .setDescription("ID da carta (use /cards e /card)")
          .setRequired(true)
      )
      .addBooleanOption((o) => o.setName("publico").setDescription("Se true, envia no chat"))
  )
  .addSubcommand((sc) =>
    sc
      .setName("remover")
      .setDescription("Remove uma carta de um slot")
      .addStringOption((o) =>
        o
          .setName("posicao")
          .setDescription("Posição/slot")
          .setRequired(true)
          .addChoices(...SLOT_CHOICES)
      )
      .addBooleanOption((o) => o.setName("publico").setDescription("Se true, envia no chat"))
  )
  .addSubcommand((sc) =>
    sc
      .setName("auto")
      .setDescription("Monta automaticamente o melhor time possível")
      .addStringOption((o) =>
        o
          .setName("formacao")
          .setDescription("Formação (opcional)")
          .addChoices(...FORMATION_CHOICES)
      )
      .addBooleanOption((o) => o.setName("publico").setDescription("Se true, envia no chat"))
  )
  .addSubcommand((sc) =>
    sc
      .setName("limpar")
      .setDescription("Limpa seu time atual")
      .addBooleanOption((o) => o.setName("publico").setDescription("Se true, envia no chat"))
  );

export default {
  data,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand(true);
    const publico = interaction.options.getBoolean("publico") ?? false;
    await interaction.deferReply({ ephemeral: !publico });

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    try {
      if (sub === "formacao") {
        const formationId = interaction.options.getString("valor", true);
        await setFormation(guildId, userId, formationId);
      }

      if (sub === "set") {
        const slotKey = interaction.options.getString("posicao", true);
        const cardId = interaction.options.getString("carta", true).trim();

        const res = await setSquadSlot(guildId, userId, slotKey, cardId);
        if (!res.ok) {
          const msg =
            res.reason === "slot_invalid" ? "Slot inválido." :
            res.reason === "not_owned" ? "Você não tem essa carta no inventário." :
            res.reason === "card_not_found" ? "Não achei essa carta no pool do bot." :
            res.reason === "wrong_position" ? `Posição incorreta. Essa carta é **${res.cardPos}** e o slot aceita: **${res.allowed.join(", ")}**.` :
            res.reason === "duplicate_not_owned" ? `Você já está usando essa carta no time e não tem duplicata (você tem ${res.owned}x).` :
            "Não consegui setar esse slot.";

          await interaction.editReply({ content: `❌ ${msg}` });
          return;
        }
      }

      if (sub === "remover") {
        const slotKey = interaction.options.getString("posicao", true);
        await removeSquadSlot(guildId, userId, slotKey);
      }

      if (sub === "auto") {
        const formationId = interaction.options.getString("formacao") ?? "4-3-3";
        await autoSquad(guildId, userId, formationId);
      }

      if (sub === "limpar") {
        await clearSquad(guildId, userId);
      }

      const data = await hydrateSquad(guildId, userId);
      const png = await renderSquadPng({
        formation: data.formation,
        lineup: data.lineup,
        overall: data.overall,
        title: process.env.SQUAD_BRAND ?? "MASTER BOT",
        subtitle: interaction.user.username
      });

      const fileName = `squad-${Date.now()}.png`;
      const attachment = new AttachmentBuilder(png, { name: fileName });

      const e = new EmbedBuilder()
        .setTitle(`⚽ Seu time • ${data.formation.name}`)
        .setDescription(buildLineupText(data.lineup))
        .setImage(`attachment://${fileName}`)
        .setFooter({ text: `OVR: ${data.overall || "—"} • Use /escalar auto ou /escalar set` });

      await interaction.editReply({ embeds: [e], files: [attachment] });
    } catch (err) {
      console.error("[/escalar] erro:", err);
      await interaction.editReply({ content: "❌ Deu erro ao montar seu time. Veja o console." });
    }
  }
};
