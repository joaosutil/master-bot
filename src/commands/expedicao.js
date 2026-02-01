import { ChannelType, SlashCommandBuilder } from "discord.js";
import {
  buildLobbyComponents,
  buildLobbyContent,
  createLobby,
  LOBBY_DURATION_MS,
  scheduleLobbyClose
} from "../game/expedicaoLobby.js";

const data = new SlashCommandBuilder()
  .setName("expedicao")
  .setDescription("Expedicoes cooperativas")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("iniciar")
      .setDescription("Inicia uma nova expedicao")
  );

export default {
  data,
  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Use este comando em um servidor.",
        ephemeral: true
      });
      return;
    }

    const channel = interaction.channel;
    const canCreateThread =
      channel &&
      "threads" in channel &&
      (channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement);

    if (!canCreateThread) {
      await interaction.reply({
        content: "Este canal nao suporta threads.",
        ephemeral: true
      });
      return;
    }

    const stamp = new Date();
    const name = `expedicao-${stamp.toISOString().replace(/[-:]/g, "").slice(0, 13)}`;

    const thread = await channel.threads.create({
      name,
      autoArchiveDuration: 60,
      reason: `Expedicao iniciada por ${interaction.user.tag}`
    });

    const expiresAt = Date.now() + LOBBY_DURATION_MS;

    const lobbyMessage = await thread.send({
      content: "Lobby da Expedicao",
      components: buildLobbyComponents(thread.id, false)
    });

    const lobby = createLobby({
      threadId: thread.id,
      messageId: lobbyMessage.id,
      ownerId: interaction.user.id,
      expiresAt
    });

    await lobbyMessage.edit({
      content: buildLobbyContent(lobby),
      components: buildLobbyComponents(thread.id, false)
    });

    scheduleLobbyClose(thread, lobbyMessage);

    await interaction.reply({
      content: `Lobby criado: ${thread.toString()}`,
      ephemeral: true
    });
  }
};