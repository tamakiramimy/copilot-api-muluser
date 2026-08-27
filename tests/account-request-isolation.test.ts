import { afterEach, describe, expect, mock, test } from "bun:test"

import type { AccountRuntime } from "~/lib/account-runtime"

import { copilotRequest } from "~/services/copilot-provider/create-provider"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const createRuntime = (id: string, copilotToken: string): AccountRuntime => ({
  account: {
    id,
    login: id,
    avatarUrl: "",
    token: `github-${id}`,
    accountType: "individual",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  githubToken: `github-${id}`,
  accountType: "individual",
  copilotToken,
  copilotTokenExpiresAt: Date.now() / 1000 + 3600,
})

describe("account request isolation", () => {
  test("keeps concurrent requests on their selected account token", async () => {
    const headers: Array<string | null> = []
    const fetchMock = mock(
      (
        _input: Parameters<typeof fetch>[0],
        init?: RequestInit,
      ): Promise<Response> => {
        headers.push(new Headers(init?.headers).get("authorization"))
        return Promise.resolve(Response.json({ ok: true }))
      },
    )
    // @ts-expect-error - Bun augments fetch with preconnect, which mocks omit.
    globalThis.fetch = fetchMock

    await Promise.all([
      copilotRequest(
        { path: "/models", method: "GET" },
        createRuntime("a", "copilot-a"),
      ),
      copilotRequest(
        { path: "/models", method: "GET" },
        createRuntime("b", "copilot-b"),
      ),
    ])

    expect(headers).toContain("Bearer copilot-a")
    expect(headers).toContain("Bearer copilot-b")
  })
})
