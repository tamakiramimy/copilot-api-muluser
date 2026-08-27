import { describe, expect, test } from "bun:test"

import type { Account } from "~/lib/accounts"
import type { ModelsResponse } from "~/services/copilot/get-models"

import { AccountRuntimeRegistry } from "~/lib/account-runtime"

const accounts: Array<Account> = [
  {
    id: "account-a",
    login: "account-a",
    avatarUrl: "",
    token: "token-a",
    accountType: "individual",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "account-b",
    login: "account-b",
    avatarUrl: "",
    token: "token-b",
    accountType: "individual",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
]

const responsesModels: ModelsResponse = {
  object: "list",
  data: [
    {
      id: "gpt-5",
      name: "GPT-5",
      object: "model",
      model_picker_enabled: true,
      preview: false,
      vendor: "openai",
      version: "1",
      supported_endpoints: ["/responses"],
      capabilities: {
        family: "gpt",
        limits: {},
        object: "model_capabilities",
        supports: {},
        tokenizer: "o200k_base",
        type: "chat",
      },
    },
  ],
}

describe("AccountRuntimeRegistry", () => {
  test("keeps account runtime state isolated", () => {
    const registry = new AccountRuntimeRegistry()
    registry.initialize(accounts)

    const first = registry.get("account-a")
    const second = registry.get("account-b")
    if (!first || !second) throw new Error("Expected account runtimes")

    first.copilotToken = "copilot-a"
    first.models = responsesModels

    expect(second.copilotToken).toBeUndefined()
    expect(second.models).toBeUndefined()
  })

  test("selects only accounts that support the requested endpoint", () => {
    const registry = new AccountRuntimeRegistry()
    registry.initialize(accounts)
    const first = registry.get("account-a")
    const second = registry.get("account-b")
    if (!first || !second) throw new Error("Expected account runtimes")

    first.models = responsesModels
    second.models = { ...responsesModels, data: [] }

    const lease = registry.acquire("dsh-electron:session-1", {
      model: "gpt-5",
      endpoint: "/responses",
    })

    expect(lease?.accountId).toBe("account-a")
    lease?.release()
  })

  test("assigns only one active request per account by default", () => {
    const registry = new AccountRuntimeRegistry()
    registry.initialize(accounts)

    const first = registry.acquire("dsh-electron:session-1")
    const second = registry.acquire("dsh-electron:session-2")
    const third = registry.acquire("dsh-electron:session-3")

    expect(first?.accountId).toBe("account-a")
    expect(second?.accountId).toBe("account-b")
    expect(third).toBeNull()
    first?.release()
    second?.release()
  })
})
