// src/index.js
import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";

import { assertConfig, config } from "./config.js";
import { connectMongo } from "./db/mongo.js";
import { loadCommands } from "./loaders/commands.js";

import { handleExpedicaoJoin } from "./game/expedicaoLobby.js";
import { handleExpedicaoAction } from "./game/expedicaoGame.js";

import {
  handleTicketButton,
  handleTicketCategorySelect,
  handleTicketCloseTagSelect,
  handleTicketCloseTagModalSubmit,
  handleTicketFormSubmit,
  handleTicketTransferSelect,
  handleTicketMessageCreate,
  startTicketAutoCloseScheduler
} from "./tickets/ticketService.js";

import { handleWelcomeMember } from "./welcome/welcomeService.js";
import {
  handleAutomodMessage,
  handleModerationMemberJoin
} from "./moderation/moderationService.js";

import { handlePrefixCommands } from "./services/prefixCommands.js";

// âœ… PACK UI (novo)
import { handlePackButton, handlePackSelect } from "./game/packs/packUi.js";
import { handleGiveawayButton, startGiveawayScheduler } from "./giveaway/giveawayService.js";
import { handleMemoryAddModalSubmit, startMemoryCapsuleScheduler } from "./services/memoryCapsuleService.js";
import { handleVerifyAnswer, handleVerifyStart } from "./services/verificationService.js";
import { handleVibeVote, startVibeCheckScheduler } from "./services/vibeCheckService.js";
import { startHealthServer } from "./services/healthServer.js";
import { startPresenceRotator } from "./services/presenceRotator.js";
import { handleMusicButton } from "./music/musicInteractions.js";

assertConfig(["token"]);
startHealthServer();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

const { commands } = await loadCommands();
client.commands = commands;

let stopPresenceRotator = null;

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Master Bot online as ${readyClient.user.tag}`);
  stopPresenceRotator = startPresenceRotator(readyClient);
  startGiveawayScheduler(client);
  startTicketAutoCloseScheduler(client);
  startMemoryCapsuleScheduler(client);
  startVibeCheckScheduler(client);
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await handleWelcomeMember(member);
  } catch (error) {
    console.warn("GuildMemberAdd welcome error:", error);
  }
  try {
    await handleModerationMemberJoin(member);
  } catch (error) {
    console.warn("GuildMemberAdd moderation error:", error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    await handleAutomodMessage(message);
  } catch (error) {
    console.warn("MessageCreate automod error:", error);
  }
  try {
    await handleTicketMessageCreate(message);
  } catch (error) {
    console.warn("MessageCreate ticket error:", error);
  }
  try {
    await handlePrefixCommands(message);
  } catch (error) {
    console.warn("MessageCreate prefix error:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  // ===== Slash Commands =====
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, { client });
    } catch (error) {
      console.error(`Command error: ${interaction.commandName}`, error);

      const payload = {
        content: "Erro ao executar este comando.",
        ephemeral: true
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    }

    return;
  }

  // ===== Buttons =====
  if (interaction.isButton()) {
    if (interaction.customId.startsWith("music:")) {
      try {
        const handled = await handleMusicButton(interaction);
        if (handled) return;
      } catch (error) {
        const msg = error?.message ?? "Erro ao controlar música.";
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: msg, ephemeral: true });
          } else {
            await interaction.reply({ content: msg, ephemeral: true });
          }
        } catch {}
        return;
      }
    }
    // âœ… PACK buttons (precisa vir antes pra nÃ£o â€œcairâ€ no resto)
    if (interaction.customId.startsWith("pack_")) {
      return await handlePackButton(interaction);
    }

    if (interaction.customId.startsWith("vibe_vote:")) {
      return await handleVibeVote(interaction);
    }

    if (interaction.customId.startsWith("sorteio_")) {
      return await handleGiveawayButton(interaction);
    }

    if (interaction.customId.startsWith("expedicao_join:")) {
      return await handleExpedicaoJoin(interaction);
    }

    if (
      interaction.customId.startsWith("expedicao_route:") ||
      interaction.customId.startsWith("expedicao_choice:") ||
      interaction.customId.startsWith("expedicao_continue:")
    ) {
      return await handleExpedicaoAction(interaction);
    }

    if (interaction.customId.startsWith("ticket_")) {
      return await handleTicketButton(interaction);
    }

    if (interaction.customId === "verify_start") {
      return await handleVerifyStart(interaction);
    }
    return;
  }

  // ===== String Select Menus =====
  if (interaction.isStringSelectMenu()) {
    // âœ… PACK select menu
    if (interaction.customId.startsWith("pack_select:")) {
      return await handlePackSelect(interaction);
    }

    if (interaction.customId.startsWith("ticket_category:")) {
      return await handleTicketCategorySelect(interaction);
    }

    if (interaction.customId.startsWith("ticket_close_tag:")) {
      return await handleTicketCloseTagSelect(interaction);
    }

    if (interaction.customId.startsWith("verify_answer:")) {
      return await handleVerifyAnswer(interaction);
    }

    return;
  }

  // ===== User Select Menus =====
  if (interaction.isUserSelectMenu()) {
    if (interaction.customId.startsWith("ticket_transfer_select:")) {
      return await handleTicketTransferSelect(interaction);
    }

    return;
  }

  // ===== Modals =====
  if (interaction.isModalSubmit()) {
    if (interaction.customId === "ticket_form") {
      return await handleTicketFormSubmit(interaction);
    }

    if (interaction.customId.startsWith("ticket_close_tag_form:")) {
      return await handleTicketCloseTagModalSubmit(interaction);
    }

    if (interaction.customId === "memory_capsule_add") {
      return await handleMemoryAddModalSubmit(interaction);
    }

    return;
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

client.on(Events.Warn, (warning) => {
  console.warn("Discord client warning:", warning);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

await connectMongo(config.mongoUri);
await client.login(config.token);

async function shutdown(signal) {
  console.log(`Shutting down (${signal})...`);
  try {
    stopPresenceRotator?.();
  } catch {}
  try {
    await client.destroy();
  } catch {}
  try {
    const mongoose = (await import("mongoose")).default;
    await mongoose.disconnect();
  } catch {}
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
