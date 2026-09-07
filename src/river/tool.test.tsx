import { SiteNode, useScene, type AnyNode, type AnyNodeId } from '@pascal-app/core'
import { useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { expect, test } from 'bun:test'
import { StrictMode } from 'react'
import { OrthographicCamera, Raycaster, Vector2, Vector3 } from 'three'
import { activateRiverTool } from '../pascal-tool-actions'
import { riverNodeOf } from './actions'
import { RiverNode } from './schema'
import { useRiverStore } from './store'
import { rebuildRiverTerrain } from './terrain'
import { RiverTool } from './tool'

test('river clicks survive native tool reactivation and renderer remounts in Site coordinates', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousEditor = useEditor.getState()
  const previousScope = useInteractionScope.getState()
  const previousScene = useScene.getState()
  const previousHistory = useScene.temporal.getState()
  const previousViewer = useViewer.getState()
  const previousRiver = useRiverStore.getState()
  const windowEvents = new EventTarget()
  const canvasEvents = new EventTarget()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowEvents })
  let renderer: Awaited<ReturnType<typeof create>> | undefined

  const camera = new OrthographicCamera(-10, 10, 7.5, -7.5, 0.1, 100)
  camera.position.set(8, 25, 12)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  const site = SiteNode.parse({
    id: 'site_river_pointer_regression',
    polygon: {
      type: 'polygon',
      points: [
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
      ],
    },
  })
  const tool = (key: string) => (
    <StrictMode>
      <group key={key} position={[14, 0, -7]} rotation={[0, 0.4, 0]}>
        <RiverTool />
      </group>
    </StrictMode>
  )
  const clickTerrain = (x: number, z: number) => {
    const screen = new Vector3(x, 0, z).project(camera)
    const init = {
      button: 0,
      pointerId: 1,
      clientX: (screen.x + 1) * 400,
      clientY: (1 - screen.y) * 300,
    }
    canvasEvents.dispatchEvent(Object.assign(new Event('pointerdown'), init))
    windowEvents.dispatchEvent(Object.assign(new Event('pointerup'), init))
  }

  try {
    useScene.setState({ nodes: { [site.id]: site }, rootNodeIds: [site.id] })
    useViewer.getState().setSelection({ selectedIds: [] })
    useViewer.setState({ cameraDragging: false, inputDragging: false })
    useRiverStore.getState().cancelRiverInteraction()
    useRiverStore.getState().setSettings({ width: 4, depth: 1 })
    activateRiverTool(useEditor.getState())
    renderer = await create(tool('initial'), {
      camera,
      width: 800,
      height: 600,
      beforeReturn(canvas) {
        const captured = new Set<number>()
        canvas.setPointerCapture = (id) => {
          captured.add(id)
        }
        canvas.releasePointerCapture = (id) => {
          captured.delete(id)
        }
        canvas.hasPointerCapture = (id) => captured.has(id)
        canvas.addEventListener = canvasEvents.addEventListener.bind(canvasEvents)
        canvas.removeEventListener = canvasEvents.removeEventListener.bind(canvasEvents)
        canvas.getBoundingClientRect = () => ({
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 800,
          bottom: 600,
          width: 800,
          height: 600,
          toJSON: () => ({}),
        })
      },
    })

    await act(async () => {
      // The controls re-arm the already mounted tool. Dispatch before a Canvas
      // render: input must read current authoring state, not a render snapshot.
      activateRiverTool(useEditor.getState())
      useRiverStore.getState().beginDraft(site.id)
      clickTerrain(-4, 0)
    })
    expect(useRiverStore.getState().draft?.points).toHaveLength(1)
    expect(useRiverStore.getState().draft!.points[0]![0]).toBeCloseTo(-4)

    await renderer.update(tool('remounted'))
    expect(useRiverStore.getState().draft?.points).toHaveLength(1)
    await act(async () => {
      activateRiverTool(useEditor.getState())
      clickTerrain(4, 2)
    })
    expect(useRiverStore.getState().draft?.points).toHaveLength(2)
    expect(useRiverStore.getState().draft!.points[1]![1]).toBeCloseTo(2)

    await renderer.advanceFrames(1, 1 / 60)
    renderer.scene.instance.updateMatrixWorld(true)
    const marker = renderer.scene.instance.getObjectByName('environment-river-point:1')!
    const worldPosition = marker.getWorldPosition(new Vector3())
    expect(worldPosition.x).toBeCloseTo(-4)
    expect(worldPosition.z).toBeCloseTo(0)

    await act(async () => {
      canvasEvents.dispatchEvent(new Event('pointerleave'))
    })
    expect(renderer.scene.instance.getObjectByName('environment-river-cursor')).toBeUndefined()

    const river = RiverNode.parse({
      id: 'river_pointer_regression',
      parentId: site.id,
      points: [
        [-4, 0],
        [4, 2],
      ],
      width: 4,
      depth: 1,
    })
    const carved = rebuildRiverTerrain(site, [river])
    await act(async () => {
      useRiverStore.getState().cancelRiverInteraction()
      useScene.setState({
        nodes: {
          [site.id]: {
            ...site,
            children: [river.id],
            terrain: carved.terrainData,
            metadata: carved.metadata,
          },
          [river.id]: river as unknown as AnyNode,
        },
      })
      useViewer.getState().setSelection({ selectedIds: [river.id as AnyNodeId] })
      activateRiverTool(useEditor.getState())
      useRiverStore.getState().editPath(river.id)
    })
    await renderer.advanceFrames(1, 1 / 60)
    renderer.scene.instance.updateMatrixWorld(true)
    const editMarker = renderer.scene.instance.getObjectByName('environment-river-point:2')!
    const editScreen = editMarker.getWorldPosition(new Vector3()).project(camera)
    const picker = new Raycaster()
    picker.setFromCamera(new Vector2(editScreen.x, editScreen.y), camera)
    const hit = picker.intersectObject(editMarker, true)[0]
    if (!hit) throw new Error('The native layer-0 raycaster cannot pick the river control point')
    const target = renderer.scene.find(({ instance }) => instance === hit.object)
    const historyBeforeDrag = useScene.temporal.getState().pastStates.length
    const riverId = river.id as AnyNodeId
    await renderer.fireEvent(target, 'pointerDown', {
      button: 0,
      pointerId: 1,
      nativeEvent: new Event('pointerdown'),
    })
    const dragScreen = new Vector3(5, 0, 1).project(camera)
    await act(async () => {
      windowEvents.dispatchEvent(
        Object.assign(new Event('pointermove'), {
          pointerId: 1,
          clientX: (dragScreen.x + 1) * 400,
          clientY: (1 - dragScreen.y) * 300,
        }),
      )
    })
    expect(useRiverStore.getState().previewRiver!.points[1]![0]).toBeCloseTo(5)
    expect(useRiverStore.getState().previewRiver!.points[1]![1]).toBeCloseTo(1)
    expect(riverNodeOf(useScene.getState().nodes[riverId])!.points[1]![0]).toBeCloseTo(4)
    expect(useScene.temporal.getState().pastStates.length).toBe(historyBeforeDrag)

    await act(async () => {
      useEditor.getState().setMode('select')
    })
    expect(useRiverStore.getState().draft).toBeNull()
    expect(useRiverStore.getState().editingRiverId).toBeNull()
    expect(riverNodeOf(useScene.getState().nodes[riverId])!.points[1]![0]).toBeCloseTo(4)
    expect(useScene.temporal.getState().pastStates.length).toBe(historyBeforeDrag)
    await renderer.unmount()
    renderer = undefined
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  } finally {
    await renderer?.unmount()
    useRiverStore.setState(previousRiver, true)
    useViewer.setState(previousViewer, true)
    useScene.setState(previousScene, true)
    useScene.temporal.setState(previousHistory, true)
    useEditor.setState(previousEditor, true)
    useInteractionScope.setState(previousScope, true)
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
