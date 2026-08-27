import { Hono } from "hono"

import { accountRuntimeRegistry } from "~/lib/account-runtime"
import { getActiveAccount } from "~/lib/accounts"
import { getCopilotUsage } from "~/services/github/get-copilot-usage"

export const usageRoute = new Hono()

usageRoute.get("/", async (c) => {
  try {
    const activeAccount = await getActiveAccount()
    if (!activeAccount) {
      return c.json({ error: "No Copilot account is configured" }, 401)
    }

    const runtime = accountRuntimeRegistry.upsert(activeAccount)
    const usage = await getCopilotUsage(runtime)
    return c.json(usage)
  } catch (error) {
    console.error("Error fetching Copilot usage:", error)
    return c.json({ error: "Failed to fetch Copilot usage" }, 500)
  }
})
