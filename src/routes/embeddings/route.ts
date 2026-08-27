import { Hono } from "hono"

import { acquireAccountRequestScope } from "~/lib/account-request"
import { forwardError } from "~/lib/error"
import {
  createEmbeddings,
  type EmbeddingRequest,
} from "~/services/copilot/create-embeddings"

export const embeddingRoutes = new Hono()

embeddingRoutes.post("/", async (c) => {
  try {
    const paylod = await c.req.json<EmbeddingRequest>()
    const scope = acquireAccountRequestScope(c, {
      protocol: "chat-completions",
      payload: paylod,
      requirement: {
        model: paylod.model,
        endpoint: "/embeddings",
      },
    })
    try {
      const response = await createEmbeddings(paylod, scope.lease.runtime)

      return c.json(response)
    } finally {
      scope.lease.release()
    }
  } catch (error) {
    return await forwardError(c, error)
  }
})
