import { Hono } from "hono"

import { accountRuntimeRegistry } from "~/lib/account-runtime"
import { getActiveAccount } from "~/lib/accounts"
import { state } from "~/lib/state"
import { localOnlyMiddleware } from "~/routes/admin/middleware"

export const tokenRoute = new Hono()

tokenRoute.use("*", localOnlyMiddleware)

tokenRoute.get("/", async (c) => {
  try {
    const activeAccount = await getActiveAccount()
    return c.json({
      token:
        activeAccount ?
          (accountRuntimeRegistry.get(activeAccount.id)?.copilotToken
          ?? state.copilotToken)
        : state.copilotToken,
    })
  } catch (error) {
    console.error("Error fetching token:", error)
    return c.json({ error: "Failed to fetch token", token: null }, 500)
  }
})
