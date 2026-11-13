import type { AnyNodeDefinition, NodeDefinition } from '@pascal-app/core'

/**
 * The editing half of an environment kind: parameters, placement/paint tools,
 * their hints and floor-plan editing extensions. Read-only viewers load the
 * render halves (`definition.render.ts`) without it.
 */
export type EnvironmentEditContribution<S extends AnyNodeDefinition['schema']> = Partial<
  Pick<NodeDefinition<S>, 'parametrics' | 'tool' | 'toolHints' | 'extensions' | 'floorplanDependencies'>
>
