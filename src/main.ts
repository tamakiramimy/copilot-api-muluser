#!/usr/bin/env node

import consola from "consola"
import { serve, type ServerHandler } from "srvx"

import { accountRuntimeRegistry } from "./lib/account-runtime"
import { getAccounts } from "./lib/accounts"
import { mergeConfigWithDefaults } from "./lib/config"
import { getAccountCopilotTokenManager } from "./lib/copilot-token-manager"
import {
  getLocalAccessPassword,
  getLocalAccessUsername,
  getServerHost,
  LOCAL_ACCESS_MODE,
} from "./lib/local-security"
import { ensurePaths } from "./lib/paths"
import { initProxyFromEnv } from "./lib/proxy"
import { state } from "./lib/state"
import { cacheModels, cacheVSCodeVersion } from "./lib/utils"

// Configuration from environment variables
const PORT = Number.parseInt(process.env.PORT || "4141", 10)
const VERBOSE = process.env.VERBOSE === "true" || process.env.DEBUG === "true"
const RATE_LIMIT =
  process.env.RATE_LIMIT ?
    Number.parseInt(process.env.RATE_LIMIT, 10)
  : undefined
const RATE_LIMIT_WAIT = process.env.RATE_LIMIT_WAIT === "true"
const SHOW_TOKEN = process.env.SHOW_TOKEN === "true"
const PROXY_ENV = process.env.PROXY_ENV === "true"

async function main(): Promise<void> {
  // Ensure config is merged with defaults at startup
  const config = mergeConfigWithDefaults()

  if (PROXY_ENV) {
    initProxyFromEnv()
  }

  state.verbose = VERBOSE
  if (VERBOSE) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.rateLimitSeconds = RATE_LIMIT ?? config.rateLimitSeconds
  state.rateLimitWait =
    process.env.RATE_LIMIT_WAIT === undefined ?
      (config.rateLimitWait ?? false)
    : RATE_LIMIT_WAIT
  state.showToken = SHOW_TOKEN

  await ensurePaths()
  await cacheVSCodeVersion()

  const accounts = await getAccounts()
  accountRuntimeRegistry.initialize(accounts.accounts)
  for (const runtime of accountRuntimeRegistry.getAll()) {
    try {
      await getAccountCopilotTokenManager(runtime).getToken()
      await cacheModels(runtime)
      consola.info(
        `Loaded ${runtime.models?.data.length ?? 0} models for ${runtime.account.login}`,
      )
    } catch (error) {
      consola.warn(`Failed to initialize ${runtime.account.login}:`, error)
    }
  }

  if (accounts.accounts.length === 0) {
    consola.warn("No account configured. Visit /admin to add an account.")
  }

  const serverUrl = `http://localhost:${PORT}`
  const serverHost = getServerHost()

  if (process.env.LOCAL_ACCESS_MODE === LOCAL_ACCESS_MODE.CONTAINER_BRIDGE) {
    if (!getLocalAccessPassword()) {
      throw new Error(
        "LOCAL_ACCESS_PASSWORD is required when LOCAL_ACCESS_MODE=container-bridge",
      )
    }

    consola.warn(
      `LOCAL_ACCESS_MODE=container-bridge is only safe when the host port is published to 127.0.0.1 and protected with Basic auth username "${getLocalAccessUsername()}".`,
    )
  }

  consola.box(`copilot-api server\n\n📋 Account Manager: ${serverUrl}/admin`)

  const { server } = await import("./server")

  serve({
    fetch: server.fetch as ServerHandler,
    port: PORT,
    hostname: serverHost,
    bun: {
      idleTimeout: 0,
    },
  })
}

main().catch((error: unknown) => {
  consola.error("Failed to start server:", error)
  process.exit(1)
})
