import {
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
  SiteNode,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { inflateSync } from 'node:zlib'
import { buildGrassFieldFloorplan } from './floorplan'
import { createGrassPaintField, encodeGrassPaintField } from './paint-field'
import { GrassFieldNode } from './schema'

const SELECTED_VIEW_STATE: NonNullable<GeometryContext['viewState']> = {
  selected: true,
  highlighted: false,
  hovered: false,
  moving: false,
  unit: 'metric',
  palette: {
    selectedStroke: '#2563eb',
    selectedFill: '#ffffff',
    selectedHatch: '#2563eb',
    wallHoverStroke: '#60a5fa',
    endpointHandleFill: '#ffffff',
    endpointHandleStroke: '#111111',
    endpointHandleHoverStroke: '#222222',
    endpointHandleActiveFill: '#333333',
    endpointHandleActiveStroke: '#444444',
    curveHandleFill: '#ffffff',
    curveHandleStroke: '#008080',
    curveHandleHoverStroke: '#00aaaa',
    measurementStroke: '#111111',
    measurementLabelBackground: '#ffffff',
    measurementLabelText: '#111111',
  },
}


describe('Ground Cover floor-plan geometry', () => {
  test('emits a smooth compound path with Nature-style delimitation', () => {
    const site = SiteNode.parse({
      id: 'site_floorplan',
      children: [],
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [200, 0],
          [200, 100],
          [0, 100],
        ],
      },
    })
    const node = GrassFieldNode.parse({
      id: 'grass-field_floorplan',
      parentId: site.id,
    })

    const floorplan = buildGrassFieldFloorplan(node, contextFor(site, [site]))
    expect(floorplan?.kind).toBe('group')
    if (floorplan?.kind !== 'group') return

    expect(floorplan.children).toHaveLength(2)
    const fill = floorplan.children[0]
    const boundary = floorplan.children[1]
    expect(fill?.kind).toBe('image')
    if (fill?.kind === 'image') {
      expect(fill.url).toStartWith('data:image/png;base64,')
    }
    expect(boundary?.kind).toBe('path')
    if (boundary?.kind !== 'path') return
    expect(boundary.d).toContain('Q')
    expect((boundary as typeof boundary & { fillRule?: string }).fillRule).toBe('evenodd')
    expect(boundary.strokeDasharray).toBe('0.18 0.12')
    expect(boundary.stroke).toBe('#a8c995')
    expect(boundary.strokeLinecap).toBe('round')
    expect(boundary.strokeLinejoin).toBe('round')
  })
  test('samples separately painted colors into one continuous fill', () => {
    const site = SiteNode.parse({
      id: 'site_multicolor_floorplan',
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
    const field = createGrassPaintField(
      { minX: 0, maxX: 8, minZ: 0, maxZ: 4 },
      '#ff0000',
      1,
    )
    for (let row = 0; row < field.rows; row += 1) {
      for (let column = Math.floor(field.cols / 2); column < field.cols; column += 1) {
        field.values.set([0, 0, 255, 255], (row * field.cols + column) * 4)
      }
    }
    const node = GrassFieldNode.parse({
      id: 'grass-field_multicolor',
      parentId: site.id,
      paintMap: encodeGrassPaintField(field),
    })

    const floorplan = buildGrassFieldFloorplan(node, contextFor(site, [site]))
    expect(floorplan?.kind).toBe('group')
    if (floorplan?.kind !== 'group') return
    const fill = floorplan.children.find((child) => child.kind === 'image')
    expect(fill?.kind).toBe('image')
    if (fill?.kind !== 'image') return
    const decoded = decodeRgbaPng(fill.url)
    const visibleColors = new Set<string>()
    for (let row = 0; row < decoded.height; row += 1) {
      const scanline = row * (decoded.width * 4 + 1)
      for (let column = 0; column < decoded.width; column += 1) {
        const offset = scanline + 1 + column * 4
        if ((decoded.scanlines[offset + 3] ?? 0) === 0) continue
        visibleColors.add(
          `${decoded.scanlines[offset]},${decoded.scanlines[offset + 1]},${decoded.scanlines[offset + 2]}`,
        )
      }
    }
    expect(visibleColors).toContain('255,0,0')
    expect(visibleColors).toContain('0,0,255')
  })


  test('keeps a selected empty field transparent without blue overrides', () => {
    const site = SiteNode.parse({
      id: 'site_empty_floorplan',
      children: [],
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      },
    })
    const node = GrassFieldNode.parse({
      id: 'grass-field_empty_floorplan',
      parentId: site.id,
      density: 0,
    })

    const floorplan = buildGrassFieldFloorplan(
      node,
      contextFor(site, [site], SELECTED_VIEW_STATE),
    )
    expect(floorplan?.kind).toBe('group')
    if (floorplan?.kind !== 'group') return
    expect(floorplan.children).toHaveLength(1)
    expect(floorplan.children[0]?.kind).toBe('polygon')
    expect(floorplan.children[0]).toMatchObject({
      kind: 'polygon',
      stroke: '#a8c995',
    })
    expect(floorplan.children[0]).toMatchObject({ kind: 'polygon', fillOpacity: 0 })
  })
})

function decodeRgbaPng(url: string): {
  width: number
  height: number
  scanlines: Uint8Array
} {
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
  const compressed = Buffer.concat(idat.map((part) => Buffer.from(part)))
  return {
    width,
    height,
    scanlines: new Uint8Array(inflateSync(compressed)),
  }
}

function contextFor(
  site: ReturnType<typeof SiteNode.parse>,
  sceneNodes: AnyNode[],
  viewState?: GeometryContext['viewState'],
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
    viewState,
  }
}
