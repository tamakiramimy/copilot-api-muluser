import type { Context } from "hono"

import {
  accountRuntimeRegistry,
  type AccountRequestRequirement,
  type AccountRuntimeLease,
} from "./account-runtime"
import { getClientNamespace } from "./client-auth"
import { HTTPError } from "./error"
import { getOrCreateRequestSessionId, type SessionProtocol } from "./session"

export interface AccountRequestScope {
  lease: AccountRuntimeLease
  sessionId: string
}

export interface AccountRequestScopeOptions {
  protocol: SessionProtocol
  payload: unknown
  requirement?: AccountRequestRequirement
}

export const acquireAccountRequestScope = (
  c: Context,
  { protocol, payload, requirement = {} }: AccountRequestScopeOptions,
): AccountRequestScope => {
  const clientNamespace = getClientNamespace(c.req.raw.headers)
  const session = getOrCreateRequestSessionId(
    protocol,
    payload,
    c.req.raw.headers,
  )
  if (session.setCookie) {
    c.header("Set-Cookie", session.setCookie)
  }

  const lease = accountRuntimeRegistry.acquire(
    `${clientNamespace}:${protocol}:${session.sessionId}`,
    requirement,
  )
  if (!lease) {
    throw new HTTPError(
      "No eligible Copilot account is currently available",
      Response.json(
        {
          error: {
            message: "No eligible Copilot account is currently available",
            type: "rate_limit_error",
          },
        },
        { status: 429 },
      ),
    )
  }

  return { lease, sessionId: session.sessionId }
}
