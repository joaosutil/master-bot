import crypto from "node:crypto";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} from "discord.js";
import { createCanvas } from "@napi-rs/canvas";
import { getGuildConfigLean, getOrCreateGuildConfigDoc, saveGuildConfigDoc } from "./guildConfigService.js";

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const challenges = global._mbVerifyChallenges ?? new Map();
global._mbVerifyChallenges = challenges;

function normalizeHex(value) {
  const raw = String(value ?? "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return raw.toLowerCase();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function hasManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function normalizeId(value) {
  const v = String(value ?? "").trim();
  return /^\d+$/.test(v) ? v : "";
}

function randomCaptchaText() {
  return randomCaptchaTextWithOptions({ length: 5, alphabet: "ABCDEFGHJKMNPQRSTUVWXYZ23456789" });
}

function randomCaptchaTextWithOptions({ length, alphabet }) {
  const len = clamp(Number(length) || 5, 4, 7);
  const abc = String(alphabet || "ABCDEFGHJKMNPQRSTUVWXYZ23456789");
  let out = "";
  for (let i = 0; i < len; i++) {
    out += abc[Math.floor(Math.random() * abc.length)];
  }
  return out;
}

function mutateCaptcha(answer, alphabet) {
  const text = String(answer);
  const abc = String(alphabet || "ABCDEFGHJKMNPQRSTUVWXYZ23456789");
  if (!text.length) return randomCaptchaTextWithOptions({ length: 5, alphabet: abc });
  const idx = Math.floor(Math.random() * text.length);
  const chars = text.split("");
  let replacement = chars[idx];
  for (let i = 0; i < 12; i++) {
    const next = abc[Math.floor(Math.random() * abc.length)];
    if (next !== replacement) {
      replacement = next;
      break;
    }
  }
  chars[idx] = replacement;
  return chars.join("");
}

function renderCaptchaPng(text, difficulty = "medium") {
  const W = 420;
  const H = 140;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // bg
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "rgba(7,8,21,1)");
  g.addColorStop(1, "rgba(12,18,35,1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // neon blobs
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.75;
  const b1 = ctx.createRadialGradient(W * 0.25, H * 0.25, 10, W * 0.25, H * 0.25, 160);
  b1.addColorStop(0, "rgba(47,255,224,0.25)");
  b1.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = b1;
  ctx.fillRect(0, 0, W, H);
  const b2 = ctx.createRadialGradient(W * 0.85, H * 0.65, 10, W * 0.85, H * 0.65, 170);
  b2.addColorStop(0, "rgba(130,87,255,0.26)");
  b2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = b2;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // lines
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 2;
  for (let y = -H; y < H * 2; y += 18) {
    ctx.beginPath();
    ctx.moveTo(-20, y);
    ctx.lineTo(W + 20, y + 40);
    ctx.stroke();
  }
  ctx.restore();

  // text
  const cfg =
    difficulty === "easy"
      ? { noise: 0.14, rotation: 0.06, warp: 0.03 }
      : difficulty === "hard"
        ? { noise: 0.32, rotation: 0.16, warp: 0.10 }
        : { noise: 0.22, rotation: 0.10, warp: 0.06 };

  const baselineY = H / 2;
  const spacing = W / (String(text).length + 1);
  const font = `900 72px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

  for (let i = 0; i < String(text).length; i++) {
    const ch = String(text)[i];
    const x = spacing * (i + 1);
    const y = baselineY + (Math.random() - 0.5) * H * cfg.warp;
    const rot = (Math.random() - 0.5) * cfg.rotation;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = font;
    ctx.lineWidth = 12;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.strokeText(ch, 0, 0);
    ctx.fillStyle = "rgba(241,245,255,0.96)";
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }

  // noise
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 120 * cfg.noise;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);

  return canvas.toBuffer("image/png");
}

function buildVerifyMessage(verification) {
  const panel = verification?.panel ?? {};
  const title = String(panel.title ?? "").trim() || "✅ Verificação";
  const description =
    String(panel.description ?? "").trim() ||
    "Clique no botão abaixo para se verificar e liberar o servidor.";
  const buttonLabel = String(panel.buttonLabel ?? "").trim() || "Verificar";
  const footerText = String(panel.footerText ?? "").trim() || "Master Bot • Verificação rápida";
  const colorHex = normalizeHex(panel.color);
  const color = colorHex ? Number.parseInt(colorHex, 16) : 0x2fffe0;

  const embed = new EmbedBuilder()
    .setTitle(title.slice(0, 256))
    .setDescription(description.slice(0, 3900))
    .setColor(color)
    .setFooter({ text: footerText.slice(0, 2048) });

  const btn = new ButtonBuilder()
    .setCustomId("verify_start")
    .setLabel(buttonLabel.slice(0, 80))
    .setStyle(ButtonStyle.Success);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(btn)]
  };
}

function buildChallengePayload({ token, options, imageName }) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`verify_answer:${token}`)
    .setPlaceholder("Selecione o código do captcha")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      options.map((opt) => ({
        label: opt,
        value: opt
      }))
    );

  const embed = new EmbedBuilder()
    .setTitle("Captcha")
    .setDescription("Selecione abaixo exatamente o que está na imagem.")
    .setColor(0x2fffe0)
    .setImage(`attachment://${imageName}`)
    .setFooter({ text: "Expira em 2 minutos." });

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select)]
  };
}

function resolveVerificationConfig(configDoc) {
  const raw = configDoc?.verification ?? {};
  return {
    enabled: Boolean(raw.enabled),
    channelId: raw.channelId ? String(raw.channelId) : "",
    messageId: raw.messageId ? String(raw.messageId) : "",
    roleId: raw.roleId ? String(raw.roleId) : "",
    removeRoleId: raw.removeRoleId ? String(raw.removeRoleId) : "",
    panel: {
      title: raw.panel?.title,
      description: raw.panel?.description,
      buttonLabel: raw.panel?.buttonLabel,
      color: raw.panel?.color,
      footerText: raw.panel?.footerText
    },
    captcha: {
      difficulty:
        raw.captcha?.difficulty === "easy" || raw.captcha?.difficulty === "hard"
          ? raw.captcha.difficulty
          : "medium"
    }
  };
}

export async function ensureVerifyPanel(interaction, { channel, role, removeRole } = {}) {
  if (!hasManageGuild(interaction)) {
    await interaction.reply({ content: "Você precisa de Manage Guild.", ephemeral: true });
    return;
  }

  if (!interaction.guild) {
    await interaction.reply({ content: "Use este comando em um servidor.", ephemeral: true });
    return;
  }

  const targetChannel = channel ?? interaction.channel;
  if (!targetChannel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(targetChannel.type)) {
    await interaction.reply({ content: "Escolha um canal de texto.", ephemeral: true });
    return;
  }

  const roleId = normalizeId(role?.id);
  if (!roleId) {
    await interaction.reply({ content: "Escolha um cargo válido para marcar como verificado.", ephemeral: true });
    return;
  }

  const removeRoleId = normalizeId(removeRole?.id);
  if (removeRoleId && removeRoleId === roleId) {
    await interaction.reply({ content: "O cargo para remover não pode ser o mesmo cargo de verificado.", ephemeral: true });
    return;
  }

  const doc = await getOrCreateGuildConfigDoc(interaction.guildId);
  if (!doc.verification) doc.verification = {};
  doc.verification.enabled = true;
  doc.verification.channelId = targetChannel.id;
  doc.verification.roleId = roleId;
  doc.verification.removeRoleId = removeRoleId || undefined;

  const cfg = resolveVerificationConfig(doc);
  const sent = await targetChannel.send(buildVerifyMessage(cfg));
  doc.verification.messageId = sent.id;
  await saveGuildConfigDoc(doc);

  await interaction.reply({
    content: `Painel de verificação criado em ${targetChannel.toString()}.`,
    ephemeral: true
  });
}

export async function disableVerification(interaction) {
  if (!hasManageGuild(interaction)) {
    await interaction.reply({ content: "Você precisa de Manage Guild.", ephemeral: true });
    return;
  }

  const doc = await getOrCreateGuildConfigDoc(interaction.guildId);
  if (!doc.verification) doc.verification = {};
  doc.verification.enabled = false;
  await saveGuildConfigDoc(doc);

  await interaction.reply({ content: "Verificação desativada.", ephemeral: true });
}

function createChallenge(guildId, userId) {
  return createChallengeWithConfig(guildId, userId, { difficulty: "medium" });
}

function createChallengeWithConfig(guildId, userId, { difficulty } = {}) {
  const diff = difficulty === "easy" || difficulty === "hard" ? difficulty : "medium";
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const length = diff === "easy" ? 4 : diff === "hard" ? 6 : 5;

  const answer = randomCaptchaTextWithOptions({ length, alphabet });
  const decoys = new Set();
  while (decoys.size < 3) {
    const c = diff === "hard" ? mutateCaptcha(answer, alphabet) : randomCaptchaTextWithOptions({ length, alphabet });
    if (c !== answer) decoys.add(c);
  }
  const options = shuffle([answer, ...decoys]);
  const token = crypto.randomBytes(12).toString("hex");
  challenges.set(token, {
    guildId: String(guildId),
    userId: String(userId),
    answer,
    options,
    expiresAt: Date.now() + CHALLENGE_TTL_MS
  });
  return { token, answer, options };
}

function getChallenge(token) {
  const c = challenges.get(token);
  if (!c) return null;
  if (c.expiresAt < Date.now()) {
    challenges.delete(token);
    return null;
  }
  return c;
}

export async function handleVerifyStart(interaction) {
  const cfgDoc = await getGuildConfigLean(interaction.guildId).catch(() => null);
  const cfg = resolveVerificationConfig(cfgDoc);

  if (!cfg.enabled) {
    await interaction.reply({ content: "Verificação não está ativa neste servidor.", ephemeral: true });
    return;
  }

  if (!cfg.roleId) {
    await interaction.reply({ content: "Verificação está sem cargo configurado.", ephemeral: true });
    return;
  }

  const member = interaction.member;
  if (!member?.roles) {
    await interaction.reply({ content: "Não consegui ler seus cargos.", ephemeral: true });
    return;
  }

  if (member.roles.cache?.has?.(cfg.roleId)) {
    await interaction.reply({ content: "Você já está verificado.", ephemeral: true });
    return;
  }

  const { token, options, answer } = createChallengeWithConfig(interaction.guildId, interaction.user.id, cfg.captcha);
  const png = renderCaptchaPng(answer, cfg.captcha?.difficulty);
  const imageName = `captcha-${token}.png`;
  const file = new AttachmentBuilder(png, { name: imageName });

  const payload = buildChallengePayload({ token, options, imageName });
  await interaction.reply({
    ...payload,
    files: [file],
    ephemeral: true
  });
}

export async function handleVerifyAnswer(interaction) {
  const [, token] = String(interaction.customId ?? "").split(":");
  const challenge = token ? getChallenge(token) : null;

  if (!challenge) {
    await interaction.reply({
      content: "Captcha expirou. Clique em Verificar novamente.",
      ephemeral: true
    });
    return;
  }

  if (challenge.userId !== String(interaction.user.id) || challenge.guildId !== String(interaction.guildId)) {
    await interaction.reply({ content: "Este captcha não é para você.", ephemeral: true });
    return;
  }

  const selected = interaction.values?.[0];
  if (!selected) return;

  const cfgDoc = await getGuildConfigLean(interaction.guildId).catch(() => null);
  const cfg = resolveVerificationConfig(cfgDoc);
  if (!cfg.enabled || !cfg.roleId) {
    challenges.delete(token);
    await interaction.reply({ content: "Verificação não está configurada.", ephemeral: true });
    return;
  }

  if (selected !== challenge.answer) {
    challenges.delete(token);
    await interaction.reply({
      content: "Captcha incorreto. Clique em Verificar e tente novamente.",
      ephemeral: true
    });
    return;
  }

  challenges.delete(token);

  const role = interaction.guild.roles.cache.get(cfg.roleId) ?? (await interaction.guild.roles.fetch(cfg.roleId).catch(() => null));
  if (!role) {
    await interaction.reply({ content: "Cargo de verificação não encontrado.", ephemeral: true });
    return;
  }

  const removeRoleId = normalizeId(cfg.removeRoleId);
  const removeRole =
    removeRoleId
      ? interaction.guild.roles.cache.get(removeRoleId) ??
        (await interaction.guild.roles.fetch(removeRoleId).catch(() => null))
      : null;

  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: "Não tenho permissão de Manage Roles.", ephemeral: true });
    return;
  }

  let removed = false;
  if (removeRole && interaction.member.roles.cache.has(removeRole.id)) {
    try {
      await interaction.member.roles.remove(removeRole, "Verificação captcha (remover cargo)");
      removed = true;
    } catch (error) {
      console.warn("Failed to remove verification removeRole:", error);
    }
  }

  try {
    await interaction.member.roles.add(role, "Verificação captcha");
  } catch (error) {
    console.error("Failed to add verification role:", error);
    await interaction.reply({
      content: "Não consegui aplicar o cargo. Verifique se o cargo está abaixo do cargo do bot.",
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content: removed
      ? "✅ Verificado! Cargo antigo removido e verificado aplicado. Bem-vindo(a) 😄"
      : "✅ Verificado! Bem-vindo(a) 😄",
    ephemeral: true
  });
}
