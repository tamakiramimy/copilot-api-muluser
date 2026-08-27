export interface AccountSchedulingCandidate {
  id: string
  enabled: boolean
  supportsRequest: boolean
  maxConcurrentRequests?: number
  activeRequests?: number
  cooldownUntil?: number
}

export interface AccountLease {
  accountId: string
  release(): void
}

interface AffinityRecord {
  accountId: string
  expiresAt: number
}

export interface AccountSchedulerOptions {
  affinityTtlMs?: number
}

/**
 * Keeps account selection local to a proxy process. Callers own account
 * credentials and must release a lease after a response or stream completes.
 */
export class AccountScheduler {
  private readonly affinityTtlMs: number
  private readonly affinities = new Map<string, AffinityRecord>()
  private readonly activeLeases = new Map<string, number>()
  private roundRobinCursor = 0

  constructor(options: AccountSchedulerOptions = {}) {
    this.affinityTtlMs = options.affinityTtlMs ?? 30 * 60 * 1000
  }

  acquire(
    sessionKey: string,
    candidates: ReadonlyArray<AccountSchedulingCandidate>,
    now: number = Date.now(),
  ): AccountLease | null {
    const affinity = this.getAffinity(sessionKey, now)
    if (affinity) {
      const stickyCandidate = candidates.find(
        (candidate) => candidate.id === affinity.accountId,
      )

      if (stickyCandidate && this.isEligible(stickyCandidate, now)) {
        if (this.hasCapacity(stickyCandidate)) {
          return this.createLease(stickyCandidate.id)
        }

        // Preserve affinity while an otherwise healthy account is busy.
        return null
      }

      this.affinities.delete(sessionKey)
    }

    const eligible = candidates.filter(
      (candidate) =>
        this.isEligible(candidate, now) && this.hasCapacity(candidate),
    )
    if (eligible.length === 0) {
      return null
    }

    const selected = this.selectLeastLoaded(eligible)
    this.affinities.set(sessionKey, {
      accountId: selected.id,
      expiresAt: now + this.affinityTtlMs,
    })
    return this.createLease(selected.id)
  }

  invalidate(sessionKey: string): void {
    this.affinities.delete(sessionKey)
  }

  getActiveLeaseCount(accountId: string): number {
    return this.activeLeases.get(accountId) ?? 0
  }

  private getAffinity(sessionKey: string, now: number): AffinityRecord | null {
    const affinity = this.affinities.get(sessionKey)
    if (!affinity) {
      return null
    }

    if (affinity.expiresAt <= now) {
      this.affinities.delete(sessionKey)
      return null
    }

    return affinity
  }

  private isEligible(
    candidate: AccountSchedulingCandidate,
    now: number,
  ): boolean {
    return (
      candidate.enabled
      && candidate.supportsRequest
      && (candidate.cooldownUntil === undefined
        || candidate.cooldownUntil <= now)
    )
  }

  private hasCapacity(candidate: AccountSchedulingCandidate): boolean {
    const activeRequests =
      (candidate.activeRequests ?? 0) + this.getActiveLeaseCount(candidate.id)
    return (
      candidate.maxConcurrentRequests === undefined
      || activeRequests < candidate.maxConcurrentRequests
    )
  }

  private selectLeastLoaded(
    candidates: ReadonlyArray<AccountSchedulingCandidate>,
  ): AccountSchedulingCandidate {
    const sorted = [...candidates].sort((left, right) =>
      left.id.localeCompare(right.id),
    )
    const loadFor = (candidate: AccountSchedulingCandidate) =>
      (candidate.activeRequests ?? 0) + this.getActiveLeaseCount(candidate.id)
    const leastLoad = Math.min(...sorted.map((candidate) => loadFor(candidate)))
    const leastLoaded = sorted.filter(
      (candidate) => loadFor(candidate) === leastLoad,
    )
    const selected = leastLoaded[this.roundRobinCursor % leastLoaded.length]
    this.roundRobinCursor =
      (this.roundRobinCursor + 1) % Number.MAX_SAFE_INTEGER
    return selected
  }

  private createLease(accountId: string): AccountLease {
    this.activeLeases.set(accountId, this.getActiveLeaseCount(accountId) + 1)
    let released = false

    return {
      accountId,
      release: () => {
        if (released) {
          return
        }

        released = true
        const remaining = this.getActiveLeaseCount(accountId) - 1
        if (remaining > 0) {
          this.activeLeases.set(accountId, remaining)
        } else {
          this.activeLeases.delete(accountId)
        }
      },
    }
  }
}
