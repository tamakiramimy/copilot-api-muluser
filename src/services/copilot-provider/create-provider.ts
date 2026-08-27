import type { FetchFunction } from "@ai-sdk/provider-utils"

import consola from "consola"

import type { AccountRuntime } from "~/lib/account-runtime"
import type { SubagentMarker } from "~/routes/messages/subagent-marker"

import {
  copilotBaseUrl,
  copilotHeaders,
  prepareSubagentHeaders,
} from "~/lib/api-config"
import { ContextOverflowError, isContextOverflow } from "~/lib/copilot-error"
import { copilotTokenManager } from "~/lib/copilot-token-manager"
import { getAccountCopilotTokenManager } from "~/lib/copilot-token-manager"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

/**
 * Create a custom fetch that handles Copilot token refresh on 401/403.
 * When the initial request fails with 401/403, it clears the token,
 * gets a fresh one, and retries with the updated Authorization header.
 */
function createCopilotFetch(runtime?: AccountRuntime): FetchFunction {
  const RETRYABLE_STATUSES = new Set([401, 403])

  const copilotFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const tokenManager =
      runtime ? getAccountCopilotTokenManager(runtime) : copilotTokenManager
    await tokenManager.getToken()

    const response = await globalThis.fetch(input, init)

    if (RETRYABLE_STATUSES.has(response.status)) {
      tokenManager.clear()
      await tokenManager.getToken()

      // Replace Authorization header with new token
      const currentHeaders = new Headers(init?.headers)
      currentHeaders.set(
        "Authorization",
        `Bearer ${runtime?.copilotToken ?? state.copilotToken}`,
      )
      return globalThis.fetch(input, {
        ...init,
        headers: Object.fromEntries(currentHeaders.entries()),
      })
    }

    return response
  }

  return copilotFetch as FetchFunction
}

// ─── Low-level request function ──────────────────────────────────────────────

export interface CopilotRequestOptions {
  /** API path, e.g. "/chat/completions", "/responses", "/v1/messages" */
  path: string
  /** Request body (will be JSON.stringify'd). Omit for GET requests. */
  body?: unknown
  /** HTTP method, defaults to "POST" */
  method?: "GET" | "POST"
  /** Enable vision headers */
  vision?: boolean
  /** Request initiator: "agent" or "user" */
  initiator?: "agent" | "user"
  /** Subagent marker for conversation-subagent headers */
  subagentMarker?: SubagentMarker | null
  /** Session ID for x-interaction-id header */
  sessionId?: string
  /** Additional headers to merge (e.g. anthropic-beta) */
  extraHeaders?: Record<string, string>
}

/**
 * Low-level Copilot API request function.
 *
 * Combines the provider's auth/retry infrastructure with the project's
 * existing header construction. Returns a raw Response object that can
 * be consumed directly via `events(response)` for SSE or `.json()` for
 * non-streaming.
 *
 * This replaces `fetchCopilotWithRetry()` as the single entry point
 * for all Copilot API calls.
 */
export async function copilotRequest(
  options: CopilotRequestOptions,
  runtime?: AccountRuntime,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...copilotHeaders(runtime ?? state, options.vision),
  }

  if (options.initiator) {
    headers["X-Initiator"] = options.initiator
  }

  prepareSubagentHeaders(
    options.sessionId,
    Boolean(options.subagentMarker),
    headers,
  )

  if (options.extraHeaders) {
    Object.assign(headers, options.extraHeaders)
  }

  const copilotFetch = createCopilotFetch(runtime)
  const url = `${copilotBaseUrl(runtime ?? state)}${options.path}`
  const method = options.method ?? "POST"

  const response = await copilotFetch(url, {
    method,
    headers,
    ...(options.body !== undefined && {
      body: JSON.stringify(options.body),
    }),
  })

  if (!response.ok) {
    const errorText = await response
      .clone()
      .text()
      .catch(() => "")
    if (isContextOverflow(errorText)) {
      throw new ContextOverflowError(errorText, response.status, errorText)
    }
    consola.error(`Failed to request ${options.path}`, response)
    throw new HTTPError(`Failed to request ${options.path}`, response)
  }

  return response
}
