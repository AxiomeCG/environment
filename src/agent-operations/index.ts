/**
 * `@pascal-app/plugin-environment/agent-operations`: the pure planners behind Environment's
 * agent tools. Each takes the scene's nodes and returns facts plus the node changes to apply
 * (one undo step), or refuses with a code. No browser, no stores: any surface can run them.
 */
import { fillPond } from './fill-pond'
import { layGround } from './lay-ground'
import { readEnvironment } from './read-environment'
import type { AgentOperations } from './types'

export const environmentAgentOperations = {
  read_environment: readEnvironment,
  lay_ground: layGround,
  fill_pond: fillPond,
} as const satisfies AgentOperations

export { EnvironmentRefusal, refusalCode } from './refuse'
export type { FillPondInput } from './fill-pond'
export type { LayGroundAreaInput, LayGroundInput, LayGroundKind } from './lay-ground'
export type { ReadEnvironmentInput } from './read-environment'
export type {
  AgentContext,
  AgentOperation,
  AgentOperationOutcome,
  AgentOperations,
  SceneChanges,
  SceneNodes,
} from './types'
