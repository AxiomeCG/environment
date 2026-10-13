/**
 * A coded refusal of an agent operation: the request cannot be done as asked, and the `code`
 * says why in a word hosts can count. Core' `isAgentRefusal` recognises it by duck-typing
 * (`name === 'AgentRefusal'` and a string `code`), so this local class works across package
 * realms while `@pascal-app/core` does not yet export `refuse` to external plugins.
 */
export class EnvironmentRefusal extends Error {
  override readonly name = 'AgentRefusal'

  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

export function refuse(code: string, message: string, details?: Record<string, unknown>): never {
  throw new EnvironmentRefusal(code, message, details)
}

/** The refusal code of an unknown thrown value, or null when it is not a refusal. */
export function refusalCode(error: unknown): string | null {
  if (error instanceof Error && error.name === 'AgentRefusal') {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return null
}
