import { nodeRegistry } from '@pascal-app/core'
import { environmentPlugin } from '@pascal-app/plugin-environment'
import { loadExternalPlugins } from '@/lib/bootstrap'

const ENVIRONMENT_KINDS = (environmentPlugin.nodes ?? []).map((definition) => definition.kind)

export async function waitForEnvironmentRegistry(): Promise<void> {
  await loadExternalPlugins()
  const missing = ENVIRONMENT_KINDS.filter((kind) => !nodeRegistry.has(kind))

  if (missing.length > 0) {
    throw new Error(`Environment registry did not load: ${missing.join(', ')}`)
  }
}
