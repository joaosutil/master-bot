import { getGuildConfigLean } from "../services/guildConfigService.js";

function normalizeHex(value) {
  const raw = String(value ?? "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return raw.toLowerCase();
}

function normalizeRoleIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map((id) => String(id ?? "").trim()).filter(Boolean);
}

function applyVariables(text, { member }) {
  if (!text) return "";
  const guild = member.guild;
  const date = new Date().toLocaleDateString("pt-BR");
  return String(text)
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{username}", member.user.username ?? "")
    .replaceAll("{userTag}", member.user.tag ?? "")
    .replaceAll("{server}", guild?.name ?? "")
    .replaceAll("{memberCount}", String(guild?.memberCount ?? ""))
    .replaceAll("{date}", date)
    .trim();
}

function buildWelcomeEmbed(config, context) {
  const title =
    applyVariables(config.title, context) ||
    `Bem-vindo(a), ${context.member.user.username}!`;
  const description =
    applyVariables(config.description, context) ||
    "Sinta-se em casa no servidor.";

  const colorHex = normalizeHex(config.color);
  const embed = {
    title,
    description,
    color: colorHex ? Number.parseInt(colorHex, 16) : 0x2fffe0
  };

  const footerText = applyVariables(config.footerText, context);
  if (footerText) {
    embed.footer = { text: footerText };
  }

  if (config.thumbnailUrl) {
    embed.thumbnail = { url: config.thumbnailUrl };
  }

  if (config.imageUrl) {
    embed.image = { url: config.imageUrl };
  }

  const authorName = applyVariables(config.authorName, context);
  if (authorName) {
    embed.author = config.authorIconUrl
      ? { name: authorName, icon_url: config.authorIconUrl }
      : { name: authorName };
  }

  return embed;
}

export async function handleWelcomeMember(member) {
  const configDoc = await getGuildConfigLean(member.guild.id).catch(() => null);
  if (!configDoc?.welcome?.enabled) return;

  const welcome = configDoc.welcome ?? {};
  if (!welcome.channelId) return;

  const autoRoleIds = normalizeRoleIds(welcome.autoRoleIds);
  if (autoRoleIds.length) {
    try {
      await member.roles.add(autoRoleIds, "Auto-role do Master Bot (boas-vindas)");
    } catch (error) {
      console.warn("Falha ao aplicar cargos de boas-vindas:", error);
    }
  }

  const channel = await member.guild.channels
    .fetch(welcome.channelId)
    .catch(() => null);
  if (!channel || !channel.isTextBased?.()) return;

  const embed = buildWelcomeEmbed(welcome, { member });

  try {
    await channel.send({
      embeds: [embed]
    });
  } catch (error) {
    console.warn("Falha ao enviar mensagem de boas-vindas:", error);
  }
}
