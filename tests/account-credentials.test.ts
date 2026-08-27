import { expect, mock, test } from "bun:test"

import type { AccountRuntime } from "~/lib/account-runtime"
import type { ChatCompletionsPayload } from "~/services/copilot/create-chat-completions"

import { createChatCompletions } from "~/services/copilot/create-chat-completions"

const createRuntime = (accountId: string, token: string): AccountRuntime => ({
  account: {
    id: accountId,
    login: accountId,
    avatarUrl: "",
    token: `${token}-github`,
    accountType: "individual",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  githubToken: `${token}-github`,
  accountType: "individual",
  copilotToken: token,
  copilotTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
})

const payload: ChatCompletionsPayload = {
  messages: [{ role: "user", content: "hello" }],
  model: "gpt-test",
}

test("keeps concurrent account Authorization headers isolated", async () => {
  const capturedTokens: Array<string> = []
  const fetchMock = mock(
    (
      _url: string,
      options: { headers: Record<string, string> },
    ): Promise<Response> => {
      capturedTokens.push(options.headers.Authorization)
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "response",
            object: "chat.completion",
            choices: [],
          }),
      } as Response)
    },
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch

  await Promise.all([
    createChatCompletions(payload, {
      runtime: createRuntime("a", "copilot-a"),
    }),
    createChatCompletions(payload, {
      runtime: createRuntime("b", "copilot-b"),
    }),
  ])

  expect(capturedTokens).toContain("Bearer copilot-a")
  expect(capturedTokens).toContain("Bearer copilot-b")
})
