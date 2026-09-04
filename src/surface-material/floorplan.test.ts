import {
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
  SiteNode,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { inflateSync } from 'node:zlib'
import { buildSurfaceMaterialFloorplan } from './floorplan'
import { createSurfaceMaterialField, encodeSurfaceMaterialField } from './field'
import {
  SURFACE_MATERIAL_AVERAGE_COLOR,
  SURFACE_MATERIAL_PAINT_COLOR,
  type SurfaceMaterialId,
} from './material-types'
import { SurfaceMaterialNode } from './schema'

const MATERIALS = [
  'flowered-grass',
  'road-path',
  'desert-ground',
  'paved-road',
] as const satisfies readonly SurfaceMaterialId[]

describe('Surface Material floor-plan geometry', () => {
  test('renders every painted texture with its schematic main color', () => {
    const site = SiteNode.parse({
      id: 'site_surface_floorplan',
      children: [],
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [8, 0],
          [8, 4],
          [0, 4],
        ],
      },
    })
    const field = createSurfaceMaterialField({ minX: 0, maxX: 8, minZ: 0, maxZ: 4 })
    for (let row = 0; row < field.rows; row += 1) {
      for (let column = 0; column < field.cols; column += 1) {
        const x = field.origin[0] + column * field.spacing
        const material = MATERIALS[Math.min(3, Math.max(0, Math.floor((x / 8) * 4)))]!
        const color = SURFACE_MATERIAL_PAINT_COLOR[material]
        field.values.set([color.r, color.g, color.b, 255], (row * field.cols + column) * 4)
      }
    }
    const node = SurfaceMaterialNode.parse({
      id: 'surface-material_floorplan',
      parentId: site.id,
      paintMap: encodeSurfaceMaterialField(field),
    })

    const floorplan = buildSurfaceMaterialFloorplan(node, contextFor(site, [site]))
    expect(floorplan?.kind).toBe('group')
    if (floorplan?.kind !== 'group') return

    const fill = floorplan.children[0]
    const boundary = floorplan.children[1]
    expect(fill?.kind).toBe('image')
    if (fill?.kind !== 'image') return
    expect(fill.url).toStartWith('data:image/png;base64,')

    const visibleColors = decodeVisibleColors(fill.url)
    for (const material of MATERIALS) {
      expect(visibleColors).toContain(rgbKey(SURFACE_MATERIAL_AVERAGE_COLOR[material]))
    }

    expect(boundary).toMatchObject({
      kind: 'path',
      fillOpacity: 0,
      fillRule: 'evenodd',
      stroke: '#b5a58d',
      strokeDasharray: '0.18 0.12',
    })
  })

  test('keeps an unpainted Surface field transparent', () => {
    const site = SiteNode.parse({
      id: 'site_empty_surface_floorplan',
      children: [],
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
      },
    })
    const node = SurfaceMaterialNode.parse({
      id: 'surface-material_empty_floorplan',
      parentId: site.id,
    })

    const floorplan = buildSurfaceMaterialFloorplan(node, contextFor(site, [site]))
    expect(floorplan).toMatchObject({
      kind: 'group',
      children: [
        {
          kind: 'polygon',
          fillOpacity: 0,
          stroke: '#b5a58d',
        },
      ],
    })
  })
})

function rgbKey(color: readonly [number, number, number]): string {
  return color.map((channel) => Math.round(channel * 255)).join(',')
}

function decodeVisibleColors(url: string): Set<string> {
  const encoded = url.slice(url.indexOf(',') + 1)
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const idat: Uint8Array[] = []
  let width = 0
  let height = 0

  for (let offset = 8; offset < bytes.length; ) {
    const length = view.getUint32(offset)
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      const header = new DataView(data.buffer, data.byteOffset, data.byteLength)
      width = header.getUint32(0)
      height = header.getUint32(4)
    }
    if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }

  const scanlines = new Uint8Array(
    inflateSync(Buffer.concat(idat.map((part) => Buffer.from(part)))),
  )
  const colors = new Set<string>()
  for (let row = 0; row < height; row += 1) {
    const scanline = row * (width * 4 + 1)
    for (let column = 0; column < width; column += 1) {
      const offset = scanline + 1 + column * 4
      if ((scanlines[offset + 3] ?? 0) === 0) continue
      colors.add(`${scanlines[offset]},${scanlines[offset + 1]},${scanlines[offset + 2]}`)
    }
  }
  return colors
}

function contextFor(
  site: ReturnType<typeof SiteNode.parse>,
  sceneNodes: AnyNode[],
): GeometryContext {
  const nodes = Object.fromEntries(sceneNodes.map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
  return {
    parent: site,
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children: [],
    siblings: [],
  }
}
