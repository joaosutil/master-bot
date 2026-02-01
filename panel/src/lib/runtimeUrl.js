import { headers } from "next/headers";
import { env } from "./env.js";

function firstHeaderValue(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return String(value);
}

function originFromHostAndProto({ host, proto }) {
  if (!host) return null;
  const safeProto = proto === "http" || proto === "https" ? proto : "http";
  return `${safeProto}://${host}`;
}

export function getBaseUrlFromRequest(request) {
  if (env.baseUrl) return env.baseUrl;

  const proto = firstHeaderValue(request?.headers?.get?.("x-forwarded-proto"));
  const host = firstHeaderValue(request?.headers?.get?.("x-forwarded-host")) ??
    firstHeaderValue(request?.headers?.get?.("host"));

  return originFromHostAndProto({ host, proto }) ?? "http://localhost:3000";
}

export function getBaseUrlFromHeaders() {
  if (env.baseUrl) return env.baseUrl;
  const h = headers();

  const proto = firstHeaderValue(h.get("x-forwarded-proto"));
  const host =
    firstHeaderValue(h.get("x-forwarded-host")) ?? firstHeaderValue(h.get("host"));

  return originFromHostAndProto({ host, proto }) ?? "http://localhost:3000";
}

export function getDiscordRedirectUri({ baseUrl }) {
  const resolvedBaseUrl = baseUrl ?? env.baseUrl ?? getBaseUrlFromHeaders();
  return env.discordRedirectUri || `${resolvedBaseUrl}/api/auth/callback`;
}

