import { PermissionsBitField } from "discord.js";

export function requireGuild(interaction) {
  if (!interaction.inGuild?.() || !interaction.guildId) {
    throw new Error("Este comando só pode ser usado em um servidor.");
  }
  return interaction.guildId;
}

export function getMemberVoiceChannel(interaction) {
  const member = interaction.member;
  const voiceChannel = member?.voice?.channel ?? null;
  if (!voiceChannel) {
    throw new Error("Entre em uma call para usar esse comando.");
  }

  const me = interaction.guild?.members?.me ?? null;
  if (!me) return voiceChannel;

  const perms = voiceChannel.permissionsFor(me);
  if (!perms?.has(PermissionsBitField.Flags.Connect)) {
    throw new Error("Não tenho permissão para **Conectar** nessa call.");
  }
  if (!perms?.has(PermissionsBitField.Flags.Speak)) {
    throw new Error("Não tenho permissão para **Falar** nessa call.");
  }

  return voiceChannel;
}

