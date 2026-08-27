import { Hono } from "hono"

import { accountRuntimeRegistry } from "~/lib/account-runtime"
import { getActiveAccount } from "~/lib/accounts"
import { forwardError } from "~/lib/error"
import { cacheModels } from "~/lib/utils"

export const modelRoutes = new Hono()

modelRoutes.get("/", async (c) => {
  try {
    const activeAccount = await getActiveAccount()
    if (!activeAccount) {
      return c.json(
        {
          error: {
            message: "No Copilot account is configured",
            type: "auth_error",
          },
        },
        401,
      )
    }

    const runtime = accountRuntimeRegistry.upsert(activeAccount)
    if (!runtime.models) {
      await cacheModels(runtime)
    }

    const models = runtime.models?.data.map((model) => ({
      id: model.id,
      object: "model",
      type: "model",
      created: 0, // No date available from source
      created_at: new Date(0).toISOString(), // No date available from source
      owned_by: model.vendor,
      display_name: model.name,
      supported_endpoints: model.supported_endpoints ?? [],
    }))

    return c.json({
      object: "list",
      data: models,
      has_more: false,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
