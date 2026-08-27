import type { ModelsResponse } from "~/services/copilot/get-models"

import type { Account } from "./accounts"

import {
  AccountScheduler,
  type AccountLease,
  type AccountSchedulingCandidate,
} from "./account-scheduler"
import { state } from "./state"

export interface AccountRuntime {
  account: Account
  githubToken: string
  accountType: string
  vsCodeVersion?: string
  copilotToken?: string
  copilotTokenExpiresAt: number
  models?: ModelsResponse
  lastRequestTimestamp?: number
  cooldownUntil?: number
  lastError?: string
}

export interface AccountRuntimeLease extends AccountLease {
  runtime: AccountRuntime
}

export interface AccountRequestRequirement {
  model?: string
  endpoint?: string
}

/**
 * Owns mutable state that must never be shared between GitHub accounts.
 * The registry is process-local; horizontal deployments need shared affinity
 * and lease storage before they can safely add a second process.
 */
export class AccountRuntimeRegistry {
  private readonly scheduler = new AccountScheduler()
  private readonly runtimes = new Map<string, AccountRuntime>()

  initialize(accounts: ReadonlyArray<Account>): void {
    for (const account of accounts) {
      this.upsert(account)
    }
  }

  upsert(account: Account): AccountRuntime {
    const existing = this.runtimes.get(account.id)
    if (existing) {
      existing.account = account
      existing.githubToken = account.token
      existing.accountType = account.accountType
      existing.vsCodeVersion = state.vsCodeVersion
      return existing
    }

    const runtime: AccountRuntime = {
      account,
      githubToken: account.token,
      accountType: account.accountType,
      vsCodeVersion: state.vsCodeVersion,
      copilotTokenExpiresAt: 0,
    }
    this.runtimes.set(account.id, runtime)
    return runtime
  }

  get(accountId: string): AccountRuntime | undefined {
    return this.runtimes.get(accountId)
  }

  getAll(): Array<AccountRuntime> {
    return [...this.runtimes.values()]
  }

  setEnabled(accountId: string, enabled: boolean): boolean {
    const runtime = this.runtimes.get(accountId)
    if (!runtime) {
      return false
    }
    runtime.account.enabled = enabled
    return true
  }

  remove(accountId: string): boolean {
    if (this.getActiveLeaseCount(accountId) > 0) {
      return false
    }
    return this.runtimes.delete(accountId)
  }

  acquire(
    sessionKey: string,
    requirement: AccountRequestRequirement = {},
    now: number = Date.now(),
  ): AccountRuntimeLease | null {
    const candidates = this.getAll().map((runtime) =>
      this.toSchedulingCandidate(runtime, requirement),
    )
    const lease = this.scheduler.acquire(sessionKey, candidates, now)
    if (!lease) {
      return null
    }

    const runtime = this.runtimes.get(lease.accountId)
    if (!runtime) {
      lease.release()
      return null
    }

    return { ...lease, runtime }
  }

  invalidateSession(sessionKey: string): void {
    this.scheduler.invalidate(sessionKey)
  }

  getActiveLeaseCount(accountId: string): number {
    return this.scheduler.getActiveLeaseCount(accountId)
  }

  private toSchedulingCandidate(
    runtime: AccountRuntime,
    requirement: AccountRequestRequirement,
  ): AccountSchedulingCandidate {
    return {
      id: runtime.account.id,
      enabled: runtime.account.enabled ?? true,
      maxConcurrentRequests: runtime.account.maxConcurrentRequests ?? 1,
      cooldownUntil: runtime.cooldownUntil,
      supportsRequest: this.supportsRequirement(runtime, requirement),
    }
  }

  private supportsRequirement(
    runtime: AccountRuntime,
    requirement: AccountRequestRequirement,
  ): boolean {
    if (!requirement.model) {
      return true
    }

    if (!runtime.models) {
      return false
    }

    const model = runtime.models.data.find(
      (candidate) => candidate.id === requirement.model,
    )
    if (!model) {
      return false
    }

    return (
      !requirement.endpoint
      || model.supported_endpoints?.includes(requirement.endpoint) === true
    )
  }
}

export const accountRuntimeRegistry = new AccountRuntimeRegistry()
