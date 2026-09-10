import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { expect, test } from 'bun:test'
import { grassFieldDefinition } from './ground-cover/definition'
import { pondDefinition } from './pond/definition'
import { riverDefinition } from './river/definition'
import { surfaceMaterialDefinition } from './surface-material/definition'

const FLOORPLAN_EXTENSION = 'pascal:editor/floorplan'

test('exposes a mountable floorplan tool in default and expert mode for every workflow', async () => {
  const workflows = [
    ['ground cover', grassFieldDefinition],
    ['surface material', surfaceMaterialDefinition],
    ['pond', pondDefinition],
    ['river', riverDefinition],
  ] as const

  for (const [name, definition] of workflows) {
    const extensions = (
      definition as typeof definition & {
        extensions?: Record<string, FloorplanNodeExtension>
      }
    ).extensions
    const extension = extensions?.[FLOORPLAN_EXTENSION]
    expect(extension, name).toBeDefined()
    expect(extension?.availableModes, name).toEqual(['default', 'expert'])
    if (!extension?.tool) throw new Error(`${name} has no floorplan tool loader`)

    const module = await extension.tool()
    expect(typeof module.default, name).toBe('function')
  }
})
