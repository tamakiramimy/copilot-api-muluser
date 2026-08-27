import type { Context } from "hono"

import { createHash, randomUUID } from "node:crypto"

import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"

export type SessionProtocol = "anthropic" | "chat-completions" | "responses"

/**
 * Converts an arbitrary string into a deterministic UUID v4-like format
 */
const getUUID = (input: string): string => {
  const hash = createHash("sha256").update(input).digest("hex")
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-")
}

const getStringValue = (payload: unknown, key: string): string | undefined => {
  if (!payload || typeof payload !== "object") {
    return undefined
  }

  const value = (payload as Record<string, unknown>)[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

const getAnthropicSessionValue = (
  payload: AnthropicMessagesPayload,
  headers: Headers,
): string | undefined => {
  const userId = payload.metadata?.user_id
  const sessionMatch = userId ? /_session_(.+)$/.exec(userId) : null
  return sessionMatch?.[1] ?? headers.get("x-session-id") ?? undefined
}

/**
 * Returns an opaque deterministic session ID only from protocol-level session
 * fields. User identifiers are deliberately excluded from account affinity.
 */
export const getRequestSessionId = (
  protocol: SessionProtocol,
  payload: unknown,
  headers: Headers,
): string | undefined => {
  let sessionValue: string | undefined
  switch (protocol) {
    case "anthropic": {
      sessionValue = getAnthropicSessionValue(
        payload as AnthropicMessagesPayload,
        headers,
      )
      break
    }
    case "responses": {
      sessionValue =
        headers.get("x-client-request-id")
        ?? headers.get("session_id")
        ?? getStringValue(payload, "prompt_cache_key")
      break
    }
    case "chat-completions": {
      sessionValue =
        headers.get("x-client-request-id")
        ?? headers.get("x-session-affinity")
        ?? headers.get("x-session-id")
        ?? undefined
      break
    }
    default: {
      return undefined
    }
  }

  return sessionValue ? getUUID(sessionValue) : undefined
}

const getCookieValue = (headers: Headers, name: string): string | undefined =>
  headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1)

export const getOrCreateRequestSessionId = (
  protocol: SessionProtocol,
  payload: unknown,
  headers: Headers,
): { sessionId: string; setCookie?: string } => {
  const existingSessionId = getRequestSessionId(protocol, payload, headers)
  if (existingSessionId) {
    return { sessionId: existingSessionId }
  }

  const cookieName = "copilot_api_session"
  const cookieValue = getCookieValue(headers, cookieName)
  if (cookieValue) {
    return { sessionId: getUUID(cookieValue) }
  }

  const newCookieValue = randomUUID()
  return {
    sessionId: getUUID(newCookieValue),
    setCookie: `${cookieName}=${newCookieValue}; HttpOnly; Path=/; SameSite=Strict`,
  }
}

/**
 * Extracts the root session ID from the Anthropic payload or request headers.
 * Prefers `metadata.user_id` (_session_<id> pattern), falls back to `x-session-id` header.
 */
export const getRootSessionId = (
  anthropicPayload: AnthropicMessagesPayload,
  c: Context,
): string | undefined =>
  getRequestSessionId("anthropic", anthropicPayload, c.req.raw.headers)
