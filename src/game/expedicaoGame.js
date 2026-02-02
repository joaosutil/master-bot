import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";
import { addBalance } from "../economy/economyService.js";
import { formatCoins } from "../ui/embeds.js";

const MAX_STAGES = 3;
const TEAM_HP_START = 100;

const expeditions = new Map(); // threadId -> state

function nowIso() {
  return new Date().toISOString().slice(11, 19);
}

function randInt(rng, min, max) {
  const v = rng();
  return Math.floor(min + v * (max - min + 1));
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromThreadId(threadId) {
  const s = String(threadId ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function formatParty(participants) {
  if (!participants?.length) return "—";
  return participants.map((id) => `<@${id}>`).join(", ");
}

function routeOptions() {
  return [
    {
      id: "floresta",
      label: "🌲 Floresta Neon",
      desc: "Mais loot, mais risco"
    },
    {
      id: "ruinas",
      label: "🏛️ Ruínas Antigas",
      desc: "Equilibrado"
    },
    {
      id: "montanha",
      label: "⛰️ Montanha Gelada",
      desc: "Mais seguro"
    }
  ];
}

function buildRouteComponents(threadId, locked = false) {
  const row = new ActionRowBuilder();
  for (const r of routeOptions()) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`expedicao_route:${threadId}:${r.id}`)
        .setLabel(r.label)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(locked)
    );
  }
  return [row];
}

function buildContinueComponents(threadId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`expedicao_continue:${threadId}`)
        .setLabel("➡️ Continuar")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled)
    )
  ];
}

function buildChoiceComponents(threadId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`expedicao_choice:${threadId}:atacar`)
        .setLabel("⚔️ Atacar")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`expedicao_choice:${threadId}:explorar`)
        .setLabel("🧭 Explorar")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`expedicao_choice:${threadId}:recuar`)
        .setLabel("🛡️ Recuar")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    )
  ];
}

function makeEmbedBase(state) {
  return new EmbedBuilder()
    .setColor(state.route === "floresta" ? 0x22c55e : state.route === "montanha" ? 0x60a5fa : 0xf59e0b)
    .setTitle(`🧭 Expedição • Etapa ${Math.min(state.stage + 1, MAX_STAGES)}/${MAX_STAGES}`)
    .addFields(
      { name: "Party", value: formatParty(state.participants), inline: false },
      { name: "HP da equipe", value: `❤️ ${state.teamHp}/${TEAM_HP_START}`, inline: true },
      { name: "Loot (acumulado)", value: `🪙 ${formatCoins(state.loot)}`, inline: true }
    )
    .setFooter({ text: `Master Bot • ${nowIso()}` });
}

function pickEvent(state) {
  const rng = state.rng;
  const route = state.route;

  const pool = [
    {
      id: "mercador",
      title: "Mercador mascarado aparece",
      text: "Ele oferece um mapa raro… mas alguém está observando."
    },
    {
      id: "emboscada",
      title: "Emboscada!",
      text: "Sombras se movem rápido. Vocês reagem em segundos."
    },
    {
      id: "reliquia",
      title: "Relíquia brilhando",
      text: "Uma energia estranha vibra no chão, como se chamasse seu nome."
    },
    {
      id: "tempestade",
      title: "Tempestade inesperada",
      text: "O clima vira — a rota fica perigosa e barulhenta."
    }
  ];

  const base = pool[randInt(rng, 0, pool.length - 1)];
  const danger = route === "floresta" ? 1.25 : route === "montanha" ? 0.75 : 1.0;

  const difficulty = Math.max(1, Math.round(randInt(rng, 1, 5) * danger));
  return { ...base, difficulty };
}

function resolveChoice(state, choice) {
  const rng = state.rng;
  const event = state.event;
  const diff = Math.max(1, Number(event?.difficulty ?? 2));

  const routeLootMult = state.route === "floresta" ? 1.25 : state.route === "montanha" ? 0.85 : 1.0;

  let lootGain = 0;
  let hpLoss = 0;
  let headline = "";

  // Fast + consistent balancing: same levers, different profiles.
  if (choice === "atacar") {
    const success = rng() > 0.35 + diff * 0.05;
    lootGain = success ? randInt(rng, 80_000, 220_000) : randInt(rng, 20_000, 70_000);
    hpLoss = success ? randInt(rng, 6, 16) : randInt(rng, 14, 34);
    headline = success ? "Vitória rápida!" : "Resistência pesada…";
  } else if (choice === "explorar") {
    const success = rng() > 0.25 + diff * 0.06;
    lootGain = success ? randInt(rng, 120_000, 320_000) : randInt(rng, 10_000, 60_000);
    hpLoss = success ? randInt(rng, 8, 22) : randInt(rng, 12, 30);
    headline = success ? "Encontraram algo valioso!" : "O caminho cobrou um preço.";
  } else {
    // recuar
    const success = rng() > 0.10 + diff * 0.04;
    lootGain = success ? randInt(rng, 30_000, 110_000) : randInt(rng, 5_000, 35_000);
    hpLoss = success ? randInt(rng, 2, 10) : randInt(rng, 8, 18);
    headline = success ? "Retirada limpa." : "Vocês escapam… por pouco.";
  }

  lootGain = Math.max(0, Math.round(lootGain * routeLootMult));
  return { lootGain, hpLoss, headline };
}

function buildRoutePrompt(state) {
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("🧭 Expedição Cooperativa")
    .setDescription(
      "Escolha a rota para começar.\n" +
        "Dica: Floresta dá mais loot (e mais risco), Montanha é mais segura."
    )
    .addFields({ name: "Party", value: formatParty(state.participants), inline: false })
    .setFooter({ text: `Líder: ${state.ownerId} • ${nowIso()}` });

  return { embeds: [embed], components: buildRouteComponents(state.threadId, false) };
}

function buildEventView(state) {
  const e = makeEmbedBase(state)
    .setDescription(
      `**${state.event.title}**\n${state.event.text}\n\n` +
        `Dificuldade: **${state.event.difficulty}/6**\n` +
        "Escolha uma ação:"
    );

  return { embeds: [e], components: buildChoiceComponents(state.threadId, false) };
}

function buildResultView(state) {
  const e = makeEmbedBase(state).setDescription(
    `**${state.lastResult.headline}**\n` +
      `• Loot: **+${formatCoins(state.lastResult.lootGain)}** 🪙\n` +
      `• Dano: **-${state.lastResult.hpLoss}** ❤️\n\n` +
      (state.teamHp <= 0
        ? "A equipe caiu. Expedição falhou."
        : state.stage + 1 >= MAX_STAGES
          ? "Última etapa concluída. Finalizando…"
          : "Preparar para a próxima etapa.")
  );

  return {
    embeds: [e],
    components: state.teamHp <= 0 ? [] : buildContinueComponents(state.threadId, false)
  };
}

function buildFinishedView(state, { success, awardedEach = 0 } = {}) {
  const e = new EmbedBuilder()
    .setColor(success ? 0x22c55e : 0xef4444)
    .setTitle(success ? "🏁 Expedição concluída!" : "💀 Expedição falhou!")
    .setDescription(
      success
        ? `Recompensa distribuída para a party: **${formatCoins(state.loot)}** 🪙\n` +
            `Cada membro recebeu: **${formatCoins(awardedEach)}** 🪙`
        : "Sem recompensas dessa vez. Tentem de novo!"
    )
    .addFields({ name: "Party", value: formatParty(state.participants), inline: false })
    .setFooter({ text: `Master Bot • ${nowIso()}` });

  return { embeds: [e], components: [] };
}

export async function startExpeditionFromLobby(thread, lobby) {
  const threadId = thread.id;
  if (!threadId) return;

  const participants = [...(lobby?.participants ?? [])].filter(Boolean);
  if (!participants.length) return;

  const state = {
    threadId,
    ownerId: lobby.ownerId,
    participants,
    stage: 0,
    route: null,
    teamHp: TEAM_HP_START,
    loot: 0,
    phase: "route",
    event: null,
    lastResult: null,
    rng: mulberry32(seedFromThreadId(threadId))
  };

  expeditions.set(threadId, state);
  await thread.send(buildRoutePrompt(state));
}

function ensureState(threadId) {
  const s = expeditions.get(threadId);
  return s ?? null;
}

async function finishExpedition(interaction, state, { success }) {
  state.phase = "finished";

  let awardedEach = 0;
  if (success && state.loot > 0 && interaction.guildId) {
    awardedEach = Math.floor(state.loot / Math.max(1, state.participants.length));
    if (awardedEach > 0) {
      try {
        for (const userId of state.participants) {
          await addBalance(interaction.guildId, userId, awardedEach);
        }
      } catch (error) {
        console.error("Failed to award expedition rewards:", error);
      }
    }
  }

  expeditions.delete(state.threadId);
  await interaction.update(buildFinishedView(state, { success, awardedEach }));
}

export async function handleExpedicaoAction(interaction) {
  const [type, threadId, arg] = String(interaction.customId ?? "").split(":");
  if (!threadId) return;

  const state = ensureState(threadId);
  if (!state) {
    await interaction.reply({ content: "Essa expedição não está mais ativa.", ephemeral: true });
    return;
  }

  if (!state.participants.includes(interaction.user.id)) {
    await interaction.reply({ content: "Você não está nessa expedição.", ephemeral: true });
    return;
  }

  if (state.phase === "finished") {
    await interaction.reply({ content: "Expedição finalizada.", ephemeral: true });
    return;
  }

  if (type === "expedicao_route") {
    if (state.phase !== "route") {
      await interaction.reply({ content: "A rota já foi escolhida.", ephemeral: true });
      return;
    }

    // mantém simples: líder escolhe rota
    if (interaction.user.id !== state.ownerId) {
      await interaction.reply({ content: "Só o líder pode escolher a rota.", ephemeral: true });
      return;
    }

    const valid = routeOptions().some((r) => r.id === arg);
    if (!valid) return interaction.reply({ content: "Rota inválida.", ephemeral: true });

    state.route = arg;
    state.phase = "event";
    state.event = pickEvent(state);

    await interaction.update(buildEventView(state));
    return;
  }

  if (type === "expedicao_choice") {
    if (state.phase !== "event") {
      await interaction.reply({ content: "Não é hora de escolher ação agora.", ephemeral: true });
      return;
    }

    const choice = arg;
    if (!["atacar", "explorar", "recuar"].includes(choice)) {
      await interaction.reply({ content: "Ação inválida.", ephemeral: true });
      return;
    }

    // mantém simples: líder decide por todos
    if (interaction.user.id !== state.ownerId) {
      await interaction.reply({ content: "Só o líder pode decidir a ação.", ephemeral: true });
      return;
    }

    const result = resolveChoice(state, choice);
    state.lastResult = result;
    state.loot += result.lootGain;
    state.teamHp = Math.max(0, state.teamHp - result.hpLoss);
    state.phase = "result";

    if (state.teamHp <= 0) {
      await finishExpedition(interaction, state, { success: false });
      return;
    }

    await interaction.update(buildResultView(state));
    return;
  }

  if (type === "expedicao_continue") {
    if (state.phase !== "result") {
      await interaction.reply({ content: "Nada para continuar agora.", ephemeral: true });
      return;
    }

    if (interaction.user.id !== state.ownerId) {
      await interaction.reply({ content: "Só o líder pode continuar.", ephemeral: true });
      return;
    }

    state.stage += 1;
    if (state.stage >= MAX_STAGES) {
      await finishExpedition(interaction, state, { success: true });
      return;
    }

    state.phase = "event";
    state.event = pickEvent(state);
    await interaction.update(buildEventView(state));
    return;
  }
}

