import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Euler, Group, Matrix4, Quaternion, Vector3 } from 'three'
import { disposePrimitiveInstances, PrimitiveInstances } from './primitive-instances'
import type { HousePrimitive } from './primitive-instances'
import type { PresentationSurface } from './presentation-material'
import type { DistantMass, ThirdRingPlan } from './third-ring'

const FOUNDATION_REVEAL = 0.16

export function buildThirdRingInstances(plan: ThirdRingPlan, root = new Group()): Group {
  const instances = new PrimitiveInstances()
  const matrix = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  const quaternion = new Quaternion()
  const rotation = new Euler(0, 0, 0, 'YXZ')
  let primitiveCount = 0

  const addFor = (building: Pick<DistantMass, 'position' | 'rotationY'>) => {
    const cosine = Math.cos(building.rotationY), sine = Math.sin(building.rotationY)
    return (
      kind: HousePrimitive,
      surface: PresentationSurface,
      color: string,
      localX: number,
      localY: number,
      localZ: number,
      primitiveWidth: number,
      primitiveHeight: number,
      primitiveDepth: number,
      localYaw = 0,
    ) => {
      position.set(
        building.position[0] + cosine * localX + sine * localZ,
        building.position[1] + localY,
        building.position[2] - sine * localX + cosine * localZ,
      )
      quaternion.setFromEuler(rotation.set(0, building.rotationY + localYaw, 0, 'YXZ'))
      matrix.compose(position, quaternion, scale.set(
        primitiveWidth,
        primitiveHeight,
        primitiveDepth,
      ))
      instances.add(kind, surface, color, matrix)
      primitiveCount += 1
    }
  }

  for (const building of plan.buildings) {
    const add = addFor(building)
    const [width, wallHeight, depth] = building.dimensions

    const palette = building.palette
    const foundationHeight = building.foundationDepth + FOUNDATION_REVEAL
    const wallTop = FOUNDATION_REVEAL + wallHeight
    const roofHeight = Math.tan(building.roof.pitchDegrees * Math.PI / 180) * width / 2
    add('box', 'paint', palette.foundation, 0, FOUNDATION_REVEAL - foundationHeight / 2, 0,
      width + 0.22, foundationHeight, depth + 0.22)
    add('box', 'paint', palette.wall, 0, FOUNDATION_REVEAL + wallHeight / 2, 0,
      width, wallHeight, depth)
    add('box', 'paint', palette.trim, 0, wallTop + 0.04, 0,
      width + building.roof.overhang * 2, 0.12, depth + building.roof.overhang * 2)
    add(building.roof.kind, 'roof', palette.roof, 0, wallTop + 0.1, 0,
      width + building.roof.overhang * 2, roofHeight, depth + building.roof.overhang * 2)
    if (building.roof.kind === 'gable') {
      add('gable-end', 'paint', palette.wall, 0, wallTop + 0.1, 0,
        width, roofHeight, depth + 0.03)
    }
    if (building.storeys === 2) {
      add('box', 'paint', palette.trim, 0, FOUNDATION_REVEAL + 2.65, 0,
        width + 0.035, 0.09, depth + 0.035)
    }

    const addFrontOpening = (
      localX: number,
      bottom: number,
      openingWidth: number,
      openingHeight: number,
      color: string,
    ) => {
      const centerY = FOUNDATION_REVEAL + bottom + openingHeight / 2
      add('box', 'paint', palette.trim, localX, centerY, depth / 2 + 0.045,
        openingWidth + 0.16, openingHeight + 0.16, 0.07)
      add('box', 'paint', color, localX, centerY, depth / 2 + 0.09,
        openingWidth, openingHeight, 0.045)
    }
    const doorX = building.facade.doorSide * width * 0.34
    addFrontOpening(doorX, 0.04, 0.94, 2.1, palette.door)
    const lowerSlots = [-0.34, -0.11, 0.12, 0.35]
      .map((amount) => amount * width)
      .filter((localX) => Math.abs(localX - doorX) > 1.25)
      .slice(0, building.facade.frontWindowCount)
    for (const localX of lowerSlots) {
      addFrontOpening(localX, 0.86, 1.12, 1.22, palette.glass)
    }
    if (building.storeys === 2) {
      const upperSlots = building.facade.frontWindowCount === 3
        ? [-width * 0.28, 0, width * 0.28]
        : [-width * 0.24, width * 0.24]
      for (const localX of upperSlots) {
        addFrontOpening(localX, 3.52, 1.06, 1.18, palette.glass)
      }
    }

    const visibleSide: -1 | 1 = building.wing
      ? building.wing.side === 1 ? -1 : 1
      : building.facade.sideWindowSide
    const addSideWindow = (bottom: number) => {
      const centerY = FOUNDATION_REVEAL + bottom + 0.59
      const localX = visibleSide * (width / 2 + 0.045)
      const localYaw = visibleSide * Math.PI / 2
      add('box', 'paint', palette.trim, localX, centerY, -depth * 0.12,
        1.24, 1.34, 0.07, localYaw)
      add('box', 'paint', palette.glass,
        visibleSide * (width / 2 + 0.09), centerY, -depth * 0.12,
        1.06, 1.18, 0.045, localYaw)
    }
    addSideWindow(0.88)
    if (building.storeys === 2) addSideWindow(3.54)

    const wing = building.wing
    if (wing) {
      const wingX = wing.side * (width / 2 + wing.width / 2 - 0.32)
      const wingZ = depth / 2 - wing.depth / 2
      const wingWallTop = FOUNDATION_REVEAL + wing.wallHeight
      const wingRoofHeight = Math.tan(wing.roofPitchDegrees * Math.PI / 180) * wing.width / 2
      add('box', 'paint', palette.foundation, wingX,
        FOUNDATION_REVEAL - foundationHeight / 2, wingZ,
        wing.width + 0.2, foundationHeight, wing.depth + 0.2)
      add('box', 'paint', palette.wall, wingX,
        FOUNDATION_REVEAL + wing.wallHeight / 2, wingZ,
        wing.width, wing.wallHeight, wing.depth)
      add('box', 'paint', palette.trim, wingX, wingWallTop + 0.035, wingZ,
        wing.width + 0.72, 0.11, wing.depth + 0.72)
      add(wing.roofKind, 'roof', palette.roof, wingX, wingWallTop + 0.09, wingZ,
        wing.width + 0.72, wingRoofHeight, wing.depth + 0.72)
      if (wing.roofKind === 'gable') {
        add('gable-end', 'paint', palette.wall, wingX, wingWallTop + 0.09, wingZ,
          wing.width, wingRoofHeight, wing.depth + 0.03)
      }
      const garageHeight = Math.min(2.12, wing.wallHeight - 0.28)
      const garageZ = wingZ + wing.depth / 2
      add('box', 'paint', palette.trim, wingX,
        FOUNDATION_REVEAL + 0.08 + garageHeight / 2, garageZ + 0.045,
        wing.width - 0.42, garageHeight + 0.14, 0.07)
      add('box', 'paint', palette.door, wingX,
        FOUNDATION_REVEAL + 0.08 + garageHeight / 2, garageZ + 0.09,
        wing.width - 0.58, garageHeight, 0.045)
    }
  }
  for (const building of plan.skyline) {
    const add = addFor(building)
    const [width, height, depth] = building.dimensions
    const { palette } = building
    const floorHeight = height / building.storeys
    const foundationHeight = building.foundationDepth + FOUNDATION_REVEAL
    add('box', 'paint', palette.foundation, 0, FOUNDATION_REVEAL - foundationHeight / 2, 0,
      width + 4.2, foundationHeight, depth + 4.2)
    add('box', 'paint', palette.wall, 0, FOUNDATION_REVEAL + floorHeight, 0,
      width + 4, floorHeight * 2, depth + 4)
    add('box', 'paint', palette.trim, 0, FOUNDATION_REVEAL + floorHeight * 2, 0,
      width + 4.6, 0.45, depth + 4.6)

    const addSection = (sectionWidth: number, sectionDepth: number, firstFloor: number, floors: number) => {
      const bottom = FOUNDATION_REVEAL + firstFloor * floorHeight
      const sectionHeight = floors * floorHeight
      add('box', 'facade', palette.wall, 0, bottom + sectionHeight / 2, 0,
        sectionWidth, sectionHeight, sectionDepth)
      add('box', 'paint', palette.trim, 0, bottom + sectionHeight, 0,
        sectionWidth + 0.7, 0.45, sectionDepth + 0.7)
    }
    const lowerFloors = building.style === 'stepped' ? Math.floor(building.storeys * 0.65) : building.storeys
    addSection(width, depth, 0, lowerFloors)
    if (lowerFloors < building.storeys) {
      addSection(width * 0.7, depth * 0.74, lowerFloors, building.storeys - lowerFloors)
    }
    add('box', 'paint', palette.roof, 0, FOUNDATION_REVEAL + height + 1.7, 0,
      width * 0.38, 2.8, depth * 0.38)
  }
  if (plan.lighthouse) {
    const lighthouse = plan.lighthouse
    const add = addFor(lighthouse)
    const height = lighthouse.height, width = 5.2
    const foundation = lighthouse.foundationDepth + 0.4
    add('cylinder', 'paint', '#85877e', 0, 0.4 - foundation / 2, 0, 9, foundation, 9)
    add('tapered-cylinder', 'paint', '#e5e0cc', 0, height / 2 + 0.4, 0, width, height, width)
    const bandWidth = width * 0.89
    add('cylinder', 'paint', lighthouse.stripe, 0, height * 0.52, 0, bandWidth, 2.2, bandWidth)
    add('cylinder', 'paint', '#474e4e', 0, height + 0.6, 0, 5.6, 0.5, 5.6)
    add('cylinder', 'paint', '#a5c2bd', 0, height + 2, 0, 3.9, 2.4, 3.9)
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4
      add('box', 'paint', '#404a4b', Math.cos(angle) * 1.9, height + 2, Math.sin(angle) * 1.9, 0.18, 2.5, 0.18)
    }
    add('cone', 'paint', '#41484a', 0, height + 3.7, 0, 5.1, 1.2, 5.1)
    add('box', 'paint', '#85877e', 8, -foundation / 2, 0, 7.4, foundation, 6.4)
    add('box', 'paint', '#ded4bc', 8, 2, 0, 7, 4, 6)
    add('hip', 'roof', lighthouse.stripe, 8, 4.1, 0, 7.6, 1.8, 6.6)
  }
  instances.build('environment-third-ring', root)
  root.traverse((object) => { object.receiveShadow = false })
  Object.assign(root.userData, {
    buildingCount: plan.buildings.length + plan.skyline.length,
    houseCount: plan.buildings.length,
    skylineCount: plan.skyline.length,
    lighthouseCount: plan.lighthouse ? 1 : 0,
    logicalPrimitiveCount: primitiveCount,
  })
  return root
}

export function ThirdRing({ plan }: { plan: ThirdRingPlan }) {
  const root = useMemo(() => new Group(), [])
  const invalidate = useThree((state) => state.invalidate)
  useLayoutEffect(() => {
    buildThirdRingInstances(plan, root)
    invalidate()
  }, [root, plan, invalidate])
  useEffect(() => () => { disposePrimitiveInstances(root) }, [root])
  return <primitive object={root} dispose={null} />
}
