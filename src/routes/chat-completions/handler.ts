import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { acquireAccountRequestScope } from "~/lib/account-request"
import { getMappedModel } from "~/lib/config"
import { createHandlerLogger } from "~/lib/logger"
import { checkAccountRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"

const logger = createHandlerLogger("chat-completions-handler")
const CHAT_COMPLETIONS_ENDPOINT = "/chat/completions"

export async function handleCompletion(c: Context) {
  let payload = await c.req.json<ChatCompletionsPayload>()
  consola.info(`[Request] model: ${payload.model}`)
  logger.debug("Request payload:", JSON.stringify(payload).slice(-400))

  payload.model = getMappedModel(payload.model)

  const scope = acquireAccountRequestScope(c, {
    protocol: "chat-completions",
    payload,
    requirement: {
      model: payload.model,
      endpoint: CHAT_COMPLETIONS_ENDPOINT,
    },
  })
  const { lease, sessionId } = scope
  const runtime = lease.runtime

  try {
    await checkAccountRateLimit(
      runtime,
      state.rateLimitSeconds,
      state.rateLimitWait,
    )

    // Find the selected model
    const selectedModel = runtime.models?.data.find(
      (model) => model.id === payload.model,
    )

    // Calculate and display token count
    try {
      if (selectedModel) {
        const tokenCount = await getTokenCount(payload, selectedModel)
        logger.info("Current token count:", tokenCount)
      } else {
        logger.warn("No model selected, skipping token count calculation")
      }
    } catch (error) {
      logger.warn("Failed to calculate token count:", error)
    }

    if (isNullish(payload.max_tokens)) {
      payload = {
        ...payload,
        max_tokens: selectedModel?.capabilities.limits.max_output_tokens,
      }
      logger.debug("Set max_tokens to:", JSON.stringify(payload.max_tokens))
    }

    const response = await createChatCompletions(payload, {
      runtime,
      sessionId,
    })

    if (isNonStreaming(response)) {
      response.created = getEpochSec()
      logger.debug("Non-streaming response:", JSON.stringify(response))
      lease.release()
      return c.json(response)
    }

    logger.debug("Streaming response")
    return streamSSE(c, async (stream) => {
      try {
        for await (const chunk of response) {
          if (chunk.data) {
            try {
              const parsed = JSON.parse(chunk.data) as Record<string, unknown>
              parsed.created = getEpochSec()
              chunk.data = JSON.stringify(parsed)
            } catch {
              // Keep original data if not valid JSON (e.g. "[DONE]")
            }
          }
          logger.debug("Streaming chunk:", JSON.stringify(chunk))
          await stream.writeSSE(chunk as SSEMessage)
        }
      } finally {
        lease.release()
      }
    })
  } catch (error) {
    lease.release()
    throw error
  }
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const getEpochSec = () => Math.round(Date.now() / 1000)
