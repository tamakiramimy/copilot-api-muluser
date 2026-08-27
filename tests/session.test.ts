import { describe, expect, test } from "bun:test"

import { getRequestSessionId } from "~/lib/session"

describe("getRequestSessionId", () => {
  test("uses the automatic Responses request identifier", () => {
    const sessionId = getRequestSessionId(
      "responses",
      { user: "ignored-user" },
      new Headers({ "x-client-request-id": "dsh-session-17" }),
    )

    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  test("uses the Responses prompt cache key when no header is available", () => {
    const sessionId = getRequestSessionId(
      "responses",
      { prompt_cache_key: "dsh-session-17" },
      new Headers(),
    )

    expect(sessionId).toBeDefined()
  })

  test("does not use arbitrary client user metadata", () => {
    const sessionId = getRequestSessionId(
      "anthropic",
      { metadata: { user_id: "employee-123" } },
      new Headers(),
    )

    expect(sessionId).toBeUndefined()
  })

  test("falls back to the Anthropic session header after invalid metadata", () => {
    const sessionId = getRequestSessionId(
      "anthropic",
      { metadata: { user_id: "employee-123" } },
      new Headers({ "x-session-id": "dsh-session-17" }),
    )

    expect(sessionId).toBeDefined()
  })
})
