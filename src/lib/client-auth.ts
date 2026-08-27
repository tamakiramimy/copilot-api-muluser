import { timingSafeEqual } from "node:crypto"

import { HTTPError } from "./error"

interface ClientCredential {
  namespace: string
  secret: string
}

const getConfiguredClients = (): Array<ClientCredential> =>
  (process.env.COPILOT_API_CLIENT_KEYS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => {
      const separator = item.indexOf("=")
      if (separator <= 0 || separator === item.length - 1) return []
      return [
        {
          namespace: item.slice(0, separator),
          secret: item.slice(separator + 1),
        },
      ]
    })

const isSecretMatch = (expected: string, actual: string): boolean => {
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  return (
    expectedBuffer.length === actualBuffer.length
    && timingSafeEqual(expectedBuffer, actualBuffer)
  )
}

/**
 * Resolves a deployment-controlled client namespace. It never accepts a user
 * identifier or account choice from the request.
 */
export const getClientNamespace = (headers: Headers): string => {
  const configuredClients = getConfiguredClients()
  if (configuredClients.length === 0) {
    return "local"
  }

  const authorization = headers.get("authorization")
  const bearerToken = authorization?.match(/^Bearer[ \t]+(\S+)$/i)?.[1]
  const client =
    bearerToken ?
      configuredClients.find((candidate) =>
        isSecretMatch(candidate.secret, bearerToken),
      )
    : undefined
  if (client) {
    return client.namespace
  }

  throw new HTTPError(
    "Unauthorized proxy client",
    Response.json(
      { error: { message: "Unauthorized", type: "auth_error" } },
      { status: 401 },
    ),
  )
}
