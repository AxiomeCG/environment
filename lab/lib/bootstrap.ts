import {
  type AnyNodeDefinition,
  discoverPlugins,
  extendPluginDiscovery,
  loadPlugin,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { registerEditorHostPanel } from '@pascal-app/editor'
import { builtinPlugin } from '@pascal-app/nodes'
import {
  environmentHostPanel,
  environmentPlugin,
  environmentPresentation,
} from '@pascal-app/plugin-environment'
import { registerViewerPresentation } from '@pascal-app/viewer'

let builtinsLoaded = false
let externalPluginsPromise: Promise<void> | undefined

function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production'
}

function loadBuiltinsSync(): void {
  if (builtinsLoaded) return
  builtinsLoaded = true

  for (const definition of builtinPlugin.nodes ?? []) {
    const kind = (definition as AnyNodeDefinition).kind
    if (nodeRegistry.has(kind) && !isDevelopment()) continue
    registerNode(definition as AnyNodeDefinition)
  }
}

async function loadDiscoveredPlugins(): Promise<void> {
  const plugins = await discoverPlugins()
  for (const plugin of plugins) await loadPlugin(plugin)
}

export function loadExternalPlugins(): Promise<void> {
  externalPluginsPromise ??= loadDiscoveredPlugins()
  return externalPluginsPromise
}

extendPluginDiscovery(async () => [environmentPlugin])
registerEditorHostPanel(environmentHostPanel)
registerViewerPresentation(environmentPresentation)
loadBuiltinsSync()
