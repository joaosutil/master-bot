import { SlashCommandBuilder } from "discord.js";
import { economyEmbed } from "../../ui/embeds.js";
import {
  ensureFullSquad,
  enqueueOrMatch,
  runMatch
} from "../../game/match/matchService.js";

function queuedView({ mode, userId }) {
  const label = mode === "ranked" ? "RANQUEADO" : "CASUAL";
  return {
    embeds: [
      economyEmbed({
        title: `🔎 Procurando partida • ${label}`,
        description: `**<@${userId}>** está na fila.\nA partida começa automaticamente quando outro jogador usar \`/jogar ${mode === "ranked" ? "rank" : "casual"}\`.`,
        color: mode === "ranked" ? 0xf1c40f : 0x3498db,
        footer: "Tempo limite: 2 minutos"
      })
    ],
    components: []
  };
}

const data = new SlashCommandBuilder()
  .setName("jogar")
  .setDescription("Procura uma partida (casual ou ranqueada) com seu time escalado")
  .setDMPermission(false)
  .addSubcommand((sc) =>
    sc.setName("casual").setDescription("Procura partida casual (sem rank)")
  )
  .addSubcommand((sc) =>
    sc.setName("rank").setDescription("Procura partida ranqueada (com MMR)")
  );

export default {
  data,
  async execute(interaction, { client } = {}) {
    const sub = interaction.options.getSubcommand(true);
    const mode = sub === "rank" ? "ranked" : "casual";

    await interaction.deferReply({ ephemeral: false });

    // precisa ter o time completo
    const squad = await ensureFullSquad(interaction.guildId, interaction.user.id);
    if (!squad.ok) {
      const missing = squad.missing.map((x) => x.slot.label).join(", ");
      await interaction.editReply({
        embeds: [
          economyEmbed({
            title: "❌ Time incompleto",
            description:
              `Você precisa escalar **todas as 11 posições** antes de jogar.\n` +
              `Faltando: **${missing}**\n\n` +
              "Use `/escalar auto` para montar automaticamente ou `/escalar set` para setar manualmente.",
            color: 0xe74c3c
          })
        ],
        components: []
      });
      return;
    }

    // tenta entrar/match
    const state = await enqueueOrMatch({
      client,
      interaction,
      mode,
      buildQueuedView: () => queuedView({ mode, userId: interaction.user.id })
    });

    if (state.status === "already_queued") {
      await interaction.editReply({
        embeds: [
          economyEmbed({
            title: "⏳ Você já está na fila",
            description: "Aguarde um adversário ou espere a fila expirar (2 min) e tente de novo.",
            color: 0xf39c12
          })
        ],
        components: []
      });
      return;
    }

    if (state.status !== "matched") {
      // queued view already shown
      return;
    }

    // matched: edita a msg do oponente e roda partida
    const opponent = state.opponent;

    const msgA = await interaction.fetchReply();
    const msgB = await (async () => {
      const channel = await client.channels.fetch(opponent.channelId).catch(() => null);
      if (!channel || !channel.isTextBased?.()) return null;
      return await channel.messages.fetch(opponent.messageId).catch(() => null);
    })();

    if (!msgB) {
      await interaction.editReply({
        embeds: [
          economyEmbed({
            title: "❌ Falha ao iniciar",
            description: "Não consegui acessar a mensagem do adversário. Tente de novo.",
            color: 0xe74c3c
          })
        ],
        components: []
      });
      return;
    }

    // carrega squad do oponente (garante que ainda está completo)
    const squadB = await ensureFullSquad(interaction.guildId, opponent.userId);
    if (!squadB.ok) {
      await msgB.edit({
        content: `❌ <@${opponent.userId}> seu time ficou incompleto. Use /escalar e tente novamente.`,
        embeds: [],
        components: []
      });
      await interaction.editReply({
        content: `❌ O adversário (<@${opponent.userId}>) está com time incompleto agora. Tente novamente.`,
        embeds: [],
        components: []
      });
      return;
    }

    const teamA = {
      userId: interaction.user.id,
      userName: interaction.user.username,
      lineup: squad.data.lineup
    };
    const teamB = {
      userId: opponent.userId,
      userName: opponent.userId,
      lineup: squadB.data.lineup
    };

    // tenta pegar username do oponente via cache/guild
    const member = await interaction.guild.members.fetch(opponent.userId).catch(() => null);
    if (member?.user?.username) teamB.userName = member.user.username;

    await Promise.all([
      msgA.edit({
        embeds: [
          economyEmbed({
            title: "⚽ Partida encontrada!",
            description: `Modo: **${mode === "ranked" ? "Ranqueado" : "Casual"}**\nAdversário: <@${opponent.userId}>`,
            color: mode === "ranked" ? 0xf1c40f : 0x3498db
          })
        ],
        components: []
      }),
      msgB.edit({
        embeds: [
          economyEmbed({
            title: "⚽ Partida encontrada!",
            description: `Modo: **${mode === "ranked" ? "Ranqueado" : "Casual"}**\nAdversário: <@${interaction.user.id}>`,
            color: mode === "ranked" ? 0xf1c40f : 0x3498db
          })
        ],
        components: []
      })
    ]);

    const res = await runMatch({
      client,
      guildId: interaction.guildId,
      mode,
      teamA,
      teamB,
      messageA: msgA,
      messageB: msgB
    });

    if (mode === "ranked" && res.rankedInfo) {
      const a = res.rankedInfo.a;
      const b = res.rankedInfo.b;
      const suffix =
        `\n\n🏆 **Ranked MMR atualizado**\n` +
        `• ${interaction.user.username}: ${a.rankedMmr} (${res.rankedInfo.deltaA >= 0 ? "+" : ""}${res.rankedInfo.deltaA})\n` +
        `• ${teamB.userName}: ${b.rankedMmr} (${res.rankedInfo.deltaB >= 0 ? "+" : ""}${res.rankedInfo.deltaB})`;

      await Promise.all([
        msgA.edit({ content: (msgA.content || "") + suffix }).catch(() => null),
        msgB.edit({ content: (msgB.content || "") + suffix }).catch(() => null)
      ]);
    }
  }
};

