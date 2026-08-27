import { afterEach, describe, expect, test } from "bun:test"

import { getClientNamespace } from "~/lib/client-auth"

const originalKeys = process.env.COPILOT_API_CLIENT_KEYS

afterEach(() => {
  if (originalKeys === undefined) {
    delete process.env.COPILOT_API_CLIENT_KEYS
  } else {
    process.env.COPILOT_API_CLIENT_KEYS = originalKeys
  }
})

describe("getClientNamespace", () => {
  test("maps deployment-managed client keys to separate namespaces", () => {
    process.env.COPILOT_API_CLIENT_KEYS =
      "dsh-electron=dsh-secret,sub2api=sub2api-secret"

    expect(
      getClientNamespace(new Headers({ authorization: "Bearer dsh-secret" })),
    ).toBe("dsh-electron")
    expect(
      getClientNamespace(
        new Headers({ authorization: "Bearer sub2api-secret" }),
      ),
    ).toBe("sub2api")
  })

  test("rejects unknown client keys without accepting client metadata", () => {
    process.env.COPILOT_API_CLIENT_KEYS = "dsh-electron=dsh-secret"

    expect(() =>
      getClientNamespace(
        new Headers({
          authorization: "Bearer wrong-secret",
          "x-user-id": "not-used",
        }),
      ),
    ).toThrow("Unauthorized proxy client")
  })
  test("keeps local single-user startup compatible when no key is configured", () => {
    delete process.env.COPILOT_API_CLIENT_KEYS

    expect(getClientNamespace(new Headers())).toBe("local")
  })
})
