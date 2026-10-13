import type { AnyNode } from '@pascal-app/core'

/**
 * The operation shapes a host runs, mirrored from `@pascal-app/core/agent-operations`
 * (which the published core does not expose to external plugins yet). They are structural:
 * the host's typecheck rejects this export the moment the shapes drift apart.
 */
export type SceneNodes = Readonly<Record<string, AnyNode>>

export type SceneChanges = {
  create?: { node: AnyNode; parentId?: string }[]
  update?: { id: string; data: Partial<AnyNode> }[]
  delete?: string[]
}

export type AgentContext = {
  activeLevelId: string | null
}

export type AgentOperationOutcome = {
  result: Record<string, unknown>
  changes?: SceneChanges
}

export type AgentOperation<Input = never> = (
  nodes: SceneNodes,
  input: Input,
  context: AgentContext,
) => AgentOperationOutcome

export type AgentOperations = Readonly<Record<string, AgentOperation>>

export type PlanPoint = readonly [number, number]
