import { Hono } from "hono"

import type { Model } from "~/services/copilot/get-models"

import {
  accountRuntimeRegistry,
  type AccountRuntime,
} from "~/lib/account-runtime"
import {
  addAccount,
  getAccounts,
  getActiveAccount,
  removeAccount,
  setAccountEnabled,
  setActiveAccount,
  setAccountType,
  type Account,
} from "~/lib/accounts"
import { getConfig, saveConfig } from "~/lib/config"
import { getAccountCopilotTokenManager } from "~/lib/copilot-token-manager"
import { state } from "~/lib/state"
import { cacheModels } from "~/lib/utils"
import { copilotRequest } from "~/services/copilot-provider/create-provider"
import { getDeviceCode } from "~/services/github/get-device-code"
import { getGitHubUser } from "~/services/github/get-user"
import { pollAccessTokenOnce } from "~/services/github/poll-access-token"

import { adminHtml } from "./html"
import { localOnlyMiddleware } from "./middleware"

export const adminRoutes = new Hono()

// Apply localhost-only middleware to all admin routes
adminRoutes.use("*", localOnlyMiddleware)

// Get all accounts
adminRoutes.get("/api/accounts", async (c) => {
  const data = await getAccounts()

  // Return accounts without tokens for security
  const safeAccounts = data.accounts.map((account) => ({
    id: account.id,
    login: account.login,
    avatarUrl: account.avatarUrl,
    accountType: account.accountType,
    createdAt: account.createdAt,
    isActive: account.id === data.activeAccountId,
    enabled: account.enabled ?? true,
    activeRequests: accountRuntimeRegistry.getActiveLeaseCount(account.id),
    modelCount:
      accountRuntimeRegistry.get(account.id)?.models?.data.length ?? 0,
    cooldownUntil:
      accountRuntimeRegistry.get(account.id)?.cooldownUntil ?? null,
    lastError: accountRuntimeRegistry.get(account.id)?.lastError ?? null,
  }))

  return c.json({
    activeAccountId: data.activeAccountId,
    accounts: safeAccounts,
  })
})

// Get current active account
adminRoutes.get("/api/accounts/active", async (c) => {
  const account = await getActiveAccount()

  if (!account) {
    return c.json({ account: null })
  }

  return c.json({
    account: {
      id: account.id,
      login: account.login,
      avatarUrl: account.avatarUrl,
      accountType: account.accountType,
      createdAt: account.createdAt,
    },
  })
})

// Switch to a different account
adminRoutes.post("/api/accounts/:id/activate", async (c) => {
  const accountId = c.req.param("id")

  const account = await setActiveAccount(accountId)

  if (!account) {
    return c.json(
      {
        error: {
          message: "Account not found",
          type: "not_found",
        },
      },
      404,
    )
  }

  return c.json({
    success: true,
    account: {
      id: account.id,
      login: account.login,
      avatarUrl: account.avatarUrl,
      accountType: account.accountType,
    },
  })
})

adminRoutes.put("/api/accounts/:id/type", async (c) => {
  const body = await c.req.json<{ accountType?: string }>()
  const accountType = body.accountType
  if (
    accountType !== "individual"
    && accountType !== "business"
    && accountType !== "enterprise"
  ) {
    return c.json(
      {
        error: {
          message: '"accountType" must be individual, business, or enterprise',
          type: "validation_error",
        },
      },
      400,
    )
  }

  const account = await setAccountType(c.req.param("id"), accountType)
  if (!account) {
    return c.json(
      { error: { message: "Account not found", type: "not_found" } },
      404,
    )
  }

  const runtime = accountRuntimeRegistry.upsert(account)
  const tokenManager = getAccountCopilotTokenManager(runtime)
  tokenManager.clear()
  try {
    await tokenManager.getToken()
    await cacheModels(runtime)
    runtime.lastError = undefined
  } catch {
    runtime.lastError = "Failed to refresh Copilot access for this account type"
    return c.json(
      {
        error: {
          message: runtime.lastError,
          type: "copilot_connection_error",
        },
      },
      502,
    )
  }

  return c.json({
    success: true,
    account: {
      id: account.id,
      accountType: account.accountType,
      modelCount: runtime.models?.data.length ?? 0,
    },
  })
})

adminRoutes.post("/api/models/:model/test", async (c) => {
  const activeAccount = await getActiveAccount()
  const runtime =
    activeAccount ? accountRuntimeRegistry.get(activeAccount.id) : undefined
  const modelId = c.req.param("model")

  if (!runtime) {
    return c.json(
      { error: { message: "No active account runtime", type: "auth_error" } },
      401,
    )
  }

  const model = runtime.models?.data.find(
    (candidate) => candidate.id === modelId,
  )
  if (!model) {
    return c.json(
      {
        error: {
          message: "Model not available for the active account",
          type: "not_found",
        },
      },
      404,
    )
  }

  try {
    const result = await testModel(runtime, model)
    return c.json({
      success: true,
      endpoint: result.endpoint,
      prompt: `请回复一个${model.id}`,
      output: result.output,
    })
  } catch (error) {
    runtime.lastError = "Model test request failed"
    return c.json(
      {
        error: {
          message: error instanceof Error ? error.message : "Model test failed",
          type: "model_test_error",
        },
      },
      502,
    )
  }
})

const testModel = async (
  runtime: AccountRuntime,
  model: Model,
): Promise<{ endpoint: string; output: string }> => {
  const prompt = `请回复一个${model.id}`
  const endpoint = getTestEndpoint(model)
  let body: Record<string, unknown>
  if (endpoint === "/responses") {
    body = { model: model.id, input: prompt, stream: false }
  } else if (endpoint === "/v1/messages") {
    body = {
      model: model.id,
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }
  } else {
    body = {
      model: model.id,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      stream: false,
    }
  }
  const response = await copilotRequest({ path: endpoint, body }, runtime)
  return { endpoint, output: extractTestOutput(await response.json()) }
}

const getTestEndpoint = (model: Model): string => {
  const endpoints = model.supported_endpoints ?? []
  if (endpoints.includes("/responses")) return "/responses"
  if (endpoints.includes("/v1/messages")) return "/v1/messages"
  if (endpoints.includes("/chat/completions")) return "/chat/completions"
  throw new Error("The model does not declare a supported test endpoint")
}

const extractTestOutput = (result: unknown): string => {
  if (!result || typeof result !== "object") {
    return String(result)
  }
  const record = result as Record<string, unknown>
  if (typeof record.output_text === "string") return record.output_text

  const output = record.output
  if (Array.isArray(output)) {
    const text = output.flatMap((item) => getContentText(item)).join("\n")
    if (text) return text
  }

  const choices = record.choices
  if (Array.isArray(choices)) {
    const [firstChoice] = choices as Array<unknown>
    if (isRecord(firstChoice) && isRecord(firstChoice.message)) {
      const content = firstChoice.message.content
      if (typeof content === "string") return content
    }
  }

  const contentText = getContentText(record)
  if (contentText.length > 0) return contentText.join("\n")

  return "Test completed without a displayable text response."
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object"

const getContentText = (value: unknown): Array<string> => {
  if (!isRecord(value)) return []
  const record = value
  if (typeof record.text === "string") return [record.text]

  const content = record.content
  if (!Array.isArray(content)) return []
  return content.flatMap((item) => getContentText(item))
}

// Delete an account
adminRoutes.delete("/api/accounts/:id", async (c) => {
  const accountId = c.req.param("id")

  const account = await setAccountEnabled(accountId, false)
  if (!account) {
    return c.json(
      {
        error: {
          message: "Account not found",
          type: "not_found",
        },
      },
      404,
    )
  }

  accountRuntimeRegistry.setEnabled(accountId, false)
  if (accountRuntimeRegistry.getActiveLeaseCount(accountId) > 0) {
    return c.json({ success: true, draining: true })
  }

  const removed = await removeAccount(accountId)

  if (!removed) {
    return c.json(
      {
        error: {
          message: "Account not found",
          type: "not_found",
        },
      },
      404,
    )
  }

  accountRuntimeRegistry.remove(accountId)

  return c.json({ success: true })
})

// Initiate device code flow for adding new account
adminRoutes.post("/api/auth/device-code", async (c) => {
  try {
    const response = await getDeviceCode()

    return c.json({
      deviceCode: response.device_code,
      userCode: response.user_code,
      verificationUri: response.verification_uri,
      expiresIn: response.expires_in,
      interval: response.interval,
    })
  } catch {
    return c.json(
      {
        error: {
          message: "Failed to get device code",
          type: "auth_error",
        },
      },
      500,
    )
  }
})

interface PollRequestBody {
  deviceCode: string
  interval: number
  accountType?: string
}

type CreateAccountResult =
  | { success: true; account: Account }
  | { success: false; error: string }

/**
 * Create and save account after successful authorization
 */

async function createAccountFromToken(
  token: string,
  accountType: string,
): Promise<CreateAccountResult> {
  let user
  try {
    user = await getGitHubUser(token)
  } catch {
    return { success: false, error: "Failed to get user info" }
  }

  const resolvedAccountType =
    accountType === "business" || accountType === "enterprise" ?
      accountType
    : "individual"

  const account: Account = {
    id: user.id.toString(),
    login: user.login,
    avatarUrl: user.avatar_url,
    token,
    accountType: resolvedAccountType,
    createdAt: new Date().toISOString(),
  }

  await addAccount(account)
  const runtime = accountRuntimeRegistry.upsert(account)

  try {
    await getAccountCopilotTokenManager(runtime).getToken()
    await cacheModels(runtime)
  } catch {
    // Continue even if Copilot token fails
  }

  return { success: true, account }
}

// Poll for access token after user authorizes

adminRoutes.post("/api/auth/poll", async (c) => {
  const body = await c.req.json<PollRequestBody>()

  if (!body.deviceCode) {
    return c.json(
      {
        error: { message: "deviceCode is required", type: "validation_error" },
      },
      400,
    )
  }

  const result = await pollAccessTokenOnce(body.deviceCode)

  if (result.status === "pending") {
    return c.json({ pending: true, message: "Waiting for user authorization" })
  }

  if (result.status === "slow_down") {
    return c.json({
      pending: true,
      slowDown: true,
      interval: result.interval,
      message: "Rate limited, please slow down",
    })
  }

  if (result.status === "expired") {
    return c.json(
      {
        error: {
          message: "Device code expired. Please start over.",
          type: "expired",
        },
      },
      400,
    )
  }

  if (result.status === "denied") {
    return c.json(
      {
        error: { message: "Authorization was denied by user.", type: "denied" },
      },
      400,
    )
  }

  if (result.status === "error") {
    return c.json({ error: { message: result.error, type: "auth_error" } }, 500)
  }

  const accountResult = await createAccountFromToken(
    result.token,
    body.accountType ?? "individual",
  )

  if (!accountResult.success) {
    return c.json(
      { error: { message: accountResult.error, type: "auth_error" } },
      500,
    )
  }

  return c.json({
    success: true,
    account: {
      id: accountResult.account.id,
      login: accountResult.account.login,
      avatarUrl: accountResult.account.avatarUrl,
      accountType: accountResult.account.accountType,
    },
  })
})

// Get current auth status
adminRoutes.get("/api/auth/status", async (c) => {
  const activeAccount = await getActiveAccount()
  const activeRuntime =
    activeAccount ? accountRuntimeRegistry.get(activeAccount.id) : undefined

  return c.json({
    authenticated:
      activeRuntime !== undefined
      && Boolean(activeRuntime.copilotToken)
      && activeRuntime.copilotTokenExpiresAt > Date.now() / 1000 + 60,
    hasAccounts: Boolean(activeAccount),
    activeAccount:
      activeAccount ?
        {
          id: activeAccount.id,
          login: activeAccount.login,
          avatarUrl: activeAccount.avatarUrl,
          accountType: activeAccount.accountType,
        }
      : null,
  })
})

// Model Mapping API
adminRoutes.get("/api/model-mappings", (c) => {
  const config = getConfig()
  return c.json({ modelMapping: config.modelMapping ?? {} })
})

adminRoutes.get("/api/settings", (c) => {
  const config = getConfig()
  return c.json({
    rateLimitSeconds: config.rateLimitSeconds ?? null,
    rateLimitWait: config.rateLimitWait ?? false,
    envOverride: {
      rateLimitSeconds: process.env.RATE_LIMIT !== undefined,
      rateLimitWait: process.env.RATE_LIMIT_WAIT !== undefined,
    },
  })
})

adminRoutes.put("/api/settings", async (c) => {
  const body = await c.req.json<{
    rateLimitSeconds?: number | null
    rateLimitWait?: boolean
  }>()

  const rateLimitSeconds =
    body.rateLimitSeconds === null || body.rateLimitSeconds === undefined ?
      undefined
    : body.rateLimitSeconds

  if (
    rateLimitSeconds !== undefined
    && (!Number.isFinite(rateLimitSeconds) || rateLimitSeconds <= 0)
  ) {
    return c.json(
      {
        error: {
          message: '"rateLimitSeconds" must be a number greater than 0',
          type: "validation_error",
        },
      },
      400,
    )
  }

  const rateLimitWait = Boolean(body.rateLimitWait)
  const config = getConfig()
  await saveConfig({
    ...config,
    rateLimitSeconds,
    rateLimitWait,
  })

  state.rateLimitSeconds =
    process.env.RATE_LIMIT === undefined ?
      rateLimitSeconds
    : state.rateLimitSeconds
  state.rateLimitWait =
    process.env.RATE_LIMIT_WAIT === undefined ?
      rateLimitWait
    : state.rateLimitWait

  return c.json({
    success: true,
    settings: {
      rateLimitSeconds: rateLimitSeconds ?? null,
      rateLimitWait,
    },
  })
})

adminRoutes.put("/api/model-mappings/:from", async (c) => {
  const from = c.req.param("from")
  const body = await c.req.json<{ to: string }>()

  if (!body.to || typeof body.to !== "string") {
    return c.json(
      {
        error: { message: '"to" field is required', type: "validation_error" },
      },
      400,
    )
  }

  const config = getConfig()
  const modelMapping = { ...config.modelMapping, [from]: body.to }
  await saveConfig({ ...config, modelMapping })
  return c.json({ success: true, from, to: body.to })
})

adminRoutes.delete("/api/model-mappings/:from", async (c) => {
  const from = c.req.param("from")
  const config = getConfig()

  if (!config.modelMapping || !(from in config.modelMapping)) {
    return c.json(
      { error: { message: "Mapping not found", type: "not_found" } },
      404,
    )
  }

  const { [from]: _removed, ...rest } = config.modelMapping
  await saveConfig({ ...config, modelMapping: rest })
  return c.json({ success: true })
})

// Serve static HTML for admin UI
adminRoutes.get("/", (c) => {
  return c.html(adminHtml)
})
