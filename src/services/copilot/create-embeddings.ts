import type { AccountRuntime } from "~/lib/account-runtime"

import { copilotRequest } from "~/services/copilot-provider/create-provider"

export const createEmbeddings = async (
  payload: EmbeddingRequest,
  runtime?: AccountRuntime,
) => {
  const response = await copilotRequest(
    {
      path: "/embeddings",
      body: payload,
    },
    runtime,
  )

  return (await response.json()) as EmbeddingResponse
}

export interface EmbeddingRequest {
  input: string | Array<string>
  model: string
}

export interface Embedding {
  object: string
  embedding: Array<number>
  index: number
}

export interface EmbeddingResponse {
  object: string
  data: Array<Embedding>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}
