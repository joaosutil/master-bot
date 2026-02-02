import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { startExpeditionFromLobby } from "./expedicaoGame.js";

export const LOBBY_DURATION_MS = 60_000;

const lobbies = new Map();

export function buildLobbyComponents(threadId, disabled = false) {
  const joinButton = new ButtonBuilder()
    .setCustomId(`expedicao_join:${threadId}`)
    .setLabel("Entrar")
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled);

  return [new ActionRowBuilder().addComponents(joinButton)];
}

function formatParticipants(lobby) {
  const list = [...lobby.participants].map((id) => `<@${id}>`);
  return list.length ? list.join(", ") : "nenhum";
}

export function buildLobbyContent(lobby) {
  const secondsLeft = Math.max(0, Math.ceil((lobby.expiresAt - Date.now()) / 1000));
  const statusLine = lobby.closed
    ? "Lobby encerrado."
    : `Tempo restante: ${secondsLeft}s`;

  return [
    "Lobby da Expedicao",
    `Participantes: ${lobby.participants.size}`,
    statusLine,
    "Clique em Entrar para participar."
  ].join("\n");
}

export function buildLobbySummary(lobby) {
  return [
    "Expedicao pronta!",
    `Participantes (${lobby.participants.size}): ${formatParticipants(lobby)}`,
    "A expedicao vai comecar agora - o lider vai escolher a rota."
  ].join("\n");
}

export function createLobby({ threadId, messageId, ownerId, expiresAt }) {
  const lobby = {
    threadId,
    messageId,
    ownerId,
    expiresAt,
    participants: new Set([ownerId]),
    closed: false
  };

  lobbies.set(threadId, lobby);
  return lobby;
}

export function scheduleLobbyClose(thread, message) {
  setTimeout(async () => {
    const lobby = lobbies.get(thread.id);
    if (!lobby || lobby.closed) return;

    lobby.closed = true;

    try {
      await message.edit({
        content: buildLobbyContent(lobby),
        components: buildLobbyComponents(thread.id, true)
      });
    } catch (error) {
      console.error("Failed to update lobby message:", error);
    }

    try {
      await thread.send({ content: buildLobbySummary(lobby) });
    } catch (error) {
      console.error("Failed to send lobby summary:", error);
    }

    try {
      await startExpeditionFromLobby(thread, lobby);
    } catch (error) {
      console.error("Failed to start expedition:", error);
    }

    lobbies.delete(thread.id);
  }, LOBBY_DURATION_MS);
}

export async function handleExpedicaoJoin(interaction) {
  const threadId = interaction.customId.split(":")[1];
  if (!threadId) return;

  const lobby = lobbies.get(threadId);

  if (!lobby || lobby.closed || Date.now() > lobby.expiresAt) {
    if (lobby) {
      lobby.closed = true;
      lobbies.delete(threadId);
    }
    await interaction.reply({
      content: "Lobby expirado. Inicie uma nova expedicao.",
      ephemeral: true
    });
    return;
  }

  if (lobby.participants.has(interaction.user.id)) {
    await interaction.reply({
      content: "Voce ja entrou no lobby.",
      ephemeral: true
    });
    return;
  }

  lobby.participants.add(interaction.user.id);

  try {
    await interaction.update({
      content: buildLobbyContent(lobby),
      components: buildLobbyComponents(threadId, false)
    });
  } catch (error) {
    console.error("Failed to update lobby message:", error);
  }
}
