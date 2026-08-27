import { describe, expect, test } from "bun:test"

import {
  AccountScheduler,
  type AccountSchedulingCandidate,
} from "~/lib/account-scheduler"

const candidates: Array<AccountSchedulingCandidate> = [
  { id: "account-a", enabled: true, supportsRequest: true },
  { id: "account-b", enabled: true, supportsRequest: true },
]

describe("AccountScheduler", () => {
  test("balances new sessions across equally available accounts", () => {
    const scheduler = new AccountScheduler()

    const first = scheduler.acquire("session-one", candidates)
    const second = scheduler.acquire("session-two", candidates)

    expect(first?.accountId).toBe("account-a")
    expect(second?.accountId).toBe("account-b")
  })

  test("keeps a session on its assigned account", () => {
    const scheduler = new AccountScheduler()
    const first = scheduler.acquire("session-one", candidates)
    first?.release()

    const next = scheduler.acquire("session-one", candidates)

    expect(next?.accountId).toBe(first?.accountId)
  })

  test("does not assign new work to disabled accounts", () => {
    const scheduler = new AccountScheduler()
    const first = scheduler.acquire("session-one", candidates)
    first?.release()

    const next = scheduler.acquire("session-two", [
      { ...candidates[0], enabled: false },
      candidates[1],
    ])

    expect(next?.accountId).toBe("account-b")
  })

  test("waits instead of moving an active sticky session", () => {
    const scheduler = new AccountScheduler()
    const first = scheduler.acquire("session-one", [
      { ...candidates[0], maxConcurrentRequests: 1 },
      candidates[1],
    ])

    const next = scheduler.acquire("session-one", [
      { ...candidates[0], maxConcurrentRequests: 1 },
      candidates[1],
    ])

    expect(next).toBeNull()
    first?.release()
  })
})
