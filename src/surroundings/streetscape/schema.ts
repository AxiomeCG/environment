export type RoadPoint3 = [number, number, number]

export type RoadGraphNode = {
  id: string
  position: RoadPoint3
  curveRadius?: number
}

export type RoadSideComponents = {
  parkingLaneWidth: number
  bikeLaneWidth: number
  gutterWidth: number
  curbWidth: number
  vergeWidth: number
  sidewalkWidth: number
}

export type RoadStylePreset = {
  id: string
  name: string
  laneCount: number
  laneWidth: number
  shoulderWidth: number
  sidewalkWidth: number
  medianWidth: number
  surfaceThickness: number
  surfaceColor: string
  markingColor: string
  markings: boolean
  leftSide?: RoadSideComponents
  rightSide?: RoadSideComponents
}

export type RoadVerticalProfilePoint = {
  id: string
  station: number
  elevation: number
  curveLength: number
  alignmentPointIndex?: number
}

export type RoadGraphEdge = {
  id: string
  startNodeId: string
  endNodeId: string
  alignment: RoadPoint3[]
  profileMode: 'legacy' | 'designed'
  verticalProfile: RoadVerticalProfilePoint[]
  styleId: string
  direction: 'both' | 'forward' | 'reverse'
  roadClass: 'alley' | 'local' | 'collector' | 'arterial' | 'highway' | 'service'
  joinMode: 'auto' | 'suppress'
  stackLevel: number
  sourceRoadId: string
}

export type RoadJunction = {
  nodeId: string
  kind: 'tee' | 'y' | 'four-way-plus' | 'four-way-x' | 'multi-leg'
  treatment: 'auto' | 'stop' | 'yield' | 'signal' | 'roundabout'
  primaryEdgeIds: string[]
  approachControls: Record<string, 'auto' | 'none' | 'stop' | 'yield' | 'signal'>
  cornerRadii: Record<string, number>
}

export type RoadNetworkNode = {
  graphNodes: Record<string, RoadGraphNode>
  edges: Record<string, RoadGraphEdge>
  junctions: Record<string, RoadJunction>
  stylePresets: Record<string, RoadStylePreset>
  activeStyleId: string
  applyStyleToAll: boolean
  regionalPack: 'right-driving' | 'left-driving'
}
