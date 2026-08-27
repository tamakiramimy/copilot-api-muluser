import type { Context } from "hono"

import consola from "consola"

import { acquireAccountRequestScope } from "~/lib/account-request"
import { getMappedModel } from "~/lib/config"
import { getTokenCount } from "~/lib/tokenizer"

import { type AnthropicMessagesPayload } from "./anthropic-types"
import { translateToOpenAI } from "./non-stream-translation"
import { sanitizeAnthropicPayload } from "./sanitize"

/**
 * Handles token counting for Anthropic messages
 */
export async function handleCountTokens(c: Context) {
  try {
    const anthropicBeta = c.req.header("anthropic-beta")

    const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
    sanitizeAnthropicPayload(anthropicPayload)

    // Apply model mapping so count_tokens uses the same resolved model as /v1/messages
    const mappedModel = getMappedModel(anthropicPayload.model)

    const scope = acquireAccountRequestScope(c, {
      protocol: "anthropic",
      payload: anthropicPayload,
      requirement: {
        model: mappedModel,
      },
    })

    try {
      const selectedModel = scope.lease.runtime.models?.data.find(
        (model) => model.id === mappedModel,
      )

      if (!selectedModel) {
        consola.warn("Model not found, returning default token count")
        return c.json({
          input_tokens: 1,
        })
      }

      const openAIPayload = translateToOpenAI(anthropicPayload, selectedModel)
      const tokenCount = await getTokenCount(openAIPayload, selectedModel)

      tokenCount.input += getToolSystemPromptTokenCount(
        anthropicPayload,
        anthropicBeta,
      )

      let finalTokenCount = tokenCount.input + tokenCount.output
      if (anthropicPayload.model.startsWith("claude")) {
        finalTokenCount = Math.round(finalTokenCount * 1.15)
      }

      consola.info("Token count:", finalTokenCount)

      return c.json({
        input_tokens: finalTokenCount,
      })
    } finally {
      scope.lease.release()
    }
  } catch (error) {
    consola.error("Error counting tokens:", error)
    return c.json({
      input_tokens: 1,
    })
  }
}

const getToolSystemPromptTokenCount = (
  payload: AnthropicMessagesPayload,
  anthropicBeta: string | undefined,
): number => {
  const tools = payload.tools
  if (!anthropicBeta || !tools || tools.length === 0) return 0

  const shouldAddPrompt = !tools.some(
    (tool) =>
      tool.name.startsWith("mcp__")
      || (tool.name === "Skill" && tools.length === 1),
  )
  if (!shouldAddPrompt) return 0

  if (payload.model.startsWith("claude")) return 346
  if (payload.model.startsWith("grok")) return 120
  return 0
}
