import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Euler, Group, Matrix4, Quaternion, Vector3 } from 'three'
import { disposePrimitiveInstances, PrimitiveInstances } from './primitive-instances'
import type { HousePrimitive } from './primitive-instances'
import type { PresentationSurface } from './presentation-material'
import type { DistantMass, ThirdRingPlan } from './third-ring'
import { windowSurface } from './night-lighting'
import { LighthouseBeacon } from './lighthouse-beacon'

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
    const roofEnd: HousePrimitive | null = building.roof.kind === 'gable'
      ? 'gable-end'
      : building.roof.kind === 'gambrel' ? 'gambrel-end' : null
    if (roofEnd) {
      add(roofEnd, 'paint', palette.wall, 0, wallTop + 0.1, 0,
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
      windowKey?: string,
    ) => {
      const centerY = FOUNDATION_REVEAL + bottom + openingHeight / 2
      add('box', 'paint', palette.trim, localX, centerY, depth / 2 + 0.045,
        openingWidth + 0.16, openingHeight + 0.16, 0.07)
      add('box', windowKey ? windowSurface(building.id, windowKey) : 'paint',
        color, localX, centerY, depth / 2 + 0.09,
        openingWidth, openingHeight, 0.045)
    }
    const doorX = building.facade.doorSide * width * 0.34
    addFrontOpening(doorX, 0.04, 0.94, 2.1, palette.door)
    const lowerSlots = [-0.34, -0.11, 0.12, 0.35]
      .map((amount) => amount * width)
      .filter((localX) => Math.abs(localX - doorX) > 1.25)
      .slice(0, building.facade.frontWindowCount)
    lowerSlots.forEach((localX, index) => {
      addFrontOpening(localX, 0.86, 1.12, 1.22, palette.glass, `front-lower-${index}`)
    })
    if (building.storeys === 2) {
      const upperSlots = building.facade.frontWindowCount === 3
        ? [-width * 0.28, 0, width * 0.28]
        : [-width * 0.24, width * 0.24]
      upperSlots.forEach((localX, index) => {
        addFrontOpening(localX, 3.52, 1.06, 1.18, palette.glass, `front-upper-${index}`)
      })
    }

    const visibleSide: -1 | 1 = building.wing
      ? building.wing.side === 1 ? -1 : 1
      : building.facade.sideWindowSide
    const addSideWindow = (bottom: number, windowKey: string) => {
      const centerY = FOUNDATION_REVEAL + bottom + 0.59
      const localX = visibleSide * (width / 2 + 0.045)
      const localYaw = visibleSide * Math.PI / 2
      add('box', 'paint', palette.trim, localX, centerY, -depth * 0.12,
        1.24, 1.34, 0.07, localYaw)
      add('box', windowSurface(building.id, windowKey), palette.glass,
        visibleSide * (width / 2 + 0.09), centerY, -depth * 0.12,
        1.06, 1.18, 0.045, localYaw)
    }
    addSideWindow(0.88, 'side-lower')
    if (building.storeys === 2) addSideWindow(3.54, 'side-upper')

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
    const crossGable = building.crossGable
    if (crossGable) {
      const [crossX, crossZ] = crossGable.center
      const crossWallTop = FOUNDATION_REVEAL + crossGable.wallHeight
      const crossRoofHeight = Math.tan(crossGable.roofPitchDegrees * Math.PI / 180)
        * crossGable.depth / 2
      add('box', 'paint', palette.foundation, crossX,
        FOUNDATION_REVEAL - foundationHeight / 2, crossZ,
        crossGable.width + 0.2, foundationHeight, crossGable.depth + 0.2)
      add('box', 'paint', palette.wall, crossX,
        FOUNDATION_REVEAL + crossGable.wallHeight / 2, crossZ,
        crossGable.width, crossGable.wallHeight, crossGable.depth)
      add('box', 'paint', palette.trim, crossX, crossWallTop + 0.035, crossZ,
        crossGable.width + crossGable.overhang * 2, 0.11,
        crossGable.depth + crossGable.overhang * 2)
      add('gable', 'roof', palette.roof, crossX, crossWallTop + 0.09, crossZ,
        crossGable.depth + crossGable.overhang * 2, crossRoofHeight,
        crossGable.width + crossGable.overhang * 2, Math.PI / 2)
      add('gable-end', 'paint', palette.wall, crossX, crossWallTop + 0.09, crossZ,
        crossGable.depth, crossRoofHeight, crossGable.width + 0.03, Math.PI / 2)
      const openingY = FOUNDATION_REVEAL + Math.min(1.58, crossGable.wallHeight * 0.46)
      const openingZ = crossZ + crossGable.depth / 2
      add('box', 'paint', palette.trim, crossX, openingY, openingZ + 0.045,
        1.32, 1.46, 0.07)
      add('box', windowSurface(building.id, 'cross-gable-front'), palette.glass,
        crossX, openingY, openingZ + 0.09, 1.14, 1.28, 0.045)
    }
  }
  let commercialPrimitiveCount = 0
  for (const site of plan.commercialSites) {
    const countBeforeSite = primitiveCount
    const add = addFor(site)
    const [lotWidth, lotDepth] = site.lotDimensions
    const [buildingWidth, buildingHeight, buildingDepth] = site.buildingDimensions
    const { palette } = site
    const pavementHeight = site.foundationDepth + 0.12
    add('box', 'paint', palette.pavement, 0, 0.06 - pavementHeight / 2, 0,
      lotWidth, pavementHeight, lotDepth)
    add('box', 'paint', palette.pavement, 0, 0.06 - pavementHeight / 2,
      lotDepth / 2 + site.accessDepth / 2,
      site.accessWidth, pavementHeight, site.accessDepth + 0.1)

    const curbSpan = (lotWidth - site.accessWidth) / 2
    const curbX = site.accessWidth / 2 + curbSpan / 2
    for (const side of [-1, 1] as const) {
      add('box', 'paint', palette.trim, side * curbX, 0.16, lotDepth / 2 - 0.18,
        curbSpan, 0.2, 0.34)
      add('box', 'paint', palette.marking, side * (site.accessWidth / 2), 0.14,
        lotDepth / 2 - 3.2, 0.1, 0.035, 6.1)
    }

    const buildingZ = -lotDepth / 2 + buildingDepth / 2 + 1.4
    const buildingFoundation = site.foundationDepth + 0.18
    add('box', 'paint', '#6c6e69', site.buildingOffsetX,
      0.12 - buildingFoundation / 2, buildingZ,
      buildingWidth + 0.3, buildingFoundation, buildingDepth + 0.3)
    add('box', 'paint', palette.wall, site.buildingOffsetX,
      0.12 + buildingHeight / 2, buildingZ,
      buildingWidth, buildingHeight, buildingDepth)
    add('box', 'roof', palette.roof, site.buildingOffsetX,
      buildingHeight + 0.22, buildingZ,
      buildingWidth + 0.5, 0.24, buildingDepth + 0.5)
    add('box', 'paint', palette.trim, site.buildingOffsetX,
      buildingHeight + 0.42, buildingZ,
      buildingWidth + 0.62, 0.34, buildingDepth + 0.62)

    const shopfrontZ = buildingZ + buildingDepth / 2 + 0.045
    if (site.kind === 'gas-station') {
      const paneWidth = (buildingWidth - 2.2) / 3
      for (let index = 0; index < 3; index += 1) {
        const paneX = site.buildingOffsetX - buildingWidth / 2 + 0.5
          + paneWidth / 2 + index * paneWidth
        add('box', 'paint', palette.trim, paneX, 1.65, shopfrontZ,
          paneWidth - 0.12, 2.42, 0.07)
        add('box', windowSurface(site.id, `shopfront-${index}`), palette.glass,
          paneX, 1.65, shopfrontZ + 0.045,
          paneWidth - 0.28, 2.24, 0.045)
      }
      const doorX = site.buildingOffsetX + buildingWidth / 2 - 0.65
      add('box', 'paint', palette.trim, doorX, 1.34, shopfrontZ,
        1.06, 2.5, 0.07)
      add('box', windowSurface(site.id, 'shop-door'), palette.glass,
        doorX, 1.34, shopfrontZ + 0.045,
        0.9, 2.34, 0.045)

      const canopyWidth = Math.min(lotWidth - 4, 18)
      const canopyDepth = 8.6
      const canopyZ = Math.min(lotDepth / 2 - canopyDepth / 2 - 2.3, 3.4)
      const canopyHeight = 4.7
      add('box', 'paint', palette.accent, 0, canopyHeight, canopyZ,
        canopyWidth, 0.6, canopyDepth)
      add('box', 'paint', palette.trim, 0, canopyHeight - 0.04,
        canopyZ + canopyDepth / 2 + 0.23,
        canopyWidth + 0.06, 0.16, 0.34)
      for (const x of [-canopyWidth * 0.4, canopyWidth * 0.4]) {
        for (const z of [canopyZ - canopyDepth * 0.34, canopyZ + canopyDepth * 0.34]) {
          add('box', 'paint', palette.trim, x, canopyHeight / 2, z,
            0.28, canopyHeight, 0.28)
        }
      }
      for (const islandX of [-canopyWidth * 0.24, canopyWidth * 0.24]) {
        add('box', 'paint', '#a2a39d', islandX, 0.14, canopyZ,
          1.5, 0.18, 5.2)
        for (const pumpZ of [canopyZ - 1.55, canopyZ + 1.55]) {
          add('box', 'paint', '#d2cec3', islandX, 0.95, pumpZ,
            0.72, 1.65, 0.58)
          add('box', 'paint', palette.accent, islandX, 1.57, pumpZ + 0.31,
            0.74, 0.33, 0.08)
        }
      }
      const signX = lotWidth / 2 - 2
      const signZ = lotDepth / 2 - 2.1
      add('box', 'paint', '#686a67', signX, 2.7, signZ, 0.24, 5.4, 0.24)
      add('box', 'paint', palette.trim, signX, 5.15, signZ, 2.8, 2.8, 0.28)
      add('box', 'paint', palette.accent, signX, 5.34, signZ + 0.16,
        2.5, 1.9, 0.08)
    } else {
      const paneCount = 6
      const paneWidth = (buildingWidth - 2.4) / paneCount
      for (let index = 0; index < paneCount; index += 1) {
        const paneX = site.buildingOffsetX - buildingWidth / 2 + 1.2
          + paneWidth / 2 + index * paneWidth
        add('box', 'paint', palette.trim, paneX, 1.75, shopfrontZ,
          paneWidth - 0.08, 2.66, 0.07)
        add('box', windowSurface(site.id, `shopfront-${index}`), palette.glass,
          paneX, 1.75, shopfrontZ + 0.045,
          paneWidth - 0.24, 2.46, 0.045)
      }
      add('box', 'paint', palette.accent, site.buildingOffsetX,
        buildingHeight - 0.44, shopfrontZ + 0.07,
        buildingWidth + 0.16, 1.25, 0.22)
      add('box', 'paint', palette.trim, site.buildingOffsetX,
        buildingHeight - 0.44, shopfrontZ + 0.17,
        Math.min(buildingWidth * 0.32, 9), 0.3, 0.08)

      const parkingFront = lotDepth / 2 - 2
      const parkingBack = shopfrontZ - buildingDepth * 0.04 + 1.4
      const stallCount = Math.max(4, Math.min(6, Math.floor(
        (parkingFront - parkingBack) / 2.65,
      )))
      const stallGap = (parkingFront - parkingBack) / stallCount
      const lineWidth = Math.min(5.2, (lotWidth - site.accessWidth) / 2 - 1.1)
      const lineX = lotWidth / 2 - lineWidth / 2 - 0.7
      for (let index = 0; index <= stallCount; index += 1) {
        const lineZ = parkingBack + index * stallGap
        add('box', 'paint', palette.marking, -lineX, 0.14, lineZ,
          lineWidth, 0.035, 0.09)
        add('box', 'paint', palette.marking, lineX, 0.14, lineZ,
          lineWidth, 0.035, 0.09)
      }
      const cartX = -lotWidth / 2 + 3.6
      add('box', 'paint', '#71746e', cartX, 1.15, parkingBack + 1.8,
        0.18, 2.2, 3.2)
      add('box', 'paint', '#71746e', cartX + 2.7, 1.15, parkingBack + 1.8,
        0.18, 2.2, 3.2)
      add('box', 'roof', palette.accent, cartX + 1.35, 2.28, parkingBack + 1.8,
        3.1, 0.16, 3.5)
    }
    commercialPrimitiveCount += primitiveCount - countBeforeSite
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

    const addSection = (
      sectionWidth: number,
      sectionDepth: number,
      firstFloor: number,
      floors: number,
      localX = 0,
      localZ = 0,
    ) => {
      if (floors <= 0) return
      const bottom = FOUNDATION_REVEAL + firstFloor * floorHeight
      const sectionHeight = floors * floorHeight
      add('box', 'facade', palette.wall, localX, bottom + sectionHeight / 2, localZ,
        sectionWidth, sectionHeight, sectionDepth)
      add('box', 'paint', palette.trim, localX, bottom + sectionHeight, localZ,
        sectionWidth + 0.7, 0.45, sectionDepth + 0.7)
    }

    let topX = 0
    let topZ = 0
    let topWidth = width
    let topDepth = depth
    const remainingFloors = building.storeys - 2
    switch (building.style) {
      case 'stepped': {
        const lowerTop = Math.floor(building.storeys * 0.64)
        addSection(width, depth, 2, lowerTop - 2)
        topWidth = width * 0.7
        topDepth = depth * 0.74
        addSection(topWidth, topDepth, lowerTop, building.storeys - lowerTop)
        break
      }
      case 'shouldered': {
        topX = width * 0.02
        topWidth = width * 0.44
        topDepth = depth * 0.78
        addSection(topWidth, topDepth, 2, remainingFloors, topX)
        const leftWidth = width * 0.28
        const rightWidth = width * 0.32
        addSection(leftWidth, depth, 2, Math.floor(building.storeys * 0.58) - 2,
          -(topWidth + leftWidth) / 2)
        addSection(rightWidth, depth * 0.92, 2, Math.floor(building.storeys * 0.43) - 2,
          (topWidth + rightWidth) / 2)
        break
      }
      case 'podium':
        topX = -width * 0.12
        topZ = depth * 0.05
        topWidth = width * 0.62
        topDepth = depth * 0.7
        addSection(topWidth, topDepth, 2, remainingFloors, topX, topZ)
        break
      case 'crowned': {
        const crownFloors = 3
        topX = width * 0.13
        topWidth = width * 0.52
        topDepth = depth * 0.66
        addSection(width * 0.78, depth * 0.84, 2, remainingFloors - crownFloors)
        addSection(topWidth, topDepth, building.storeys - crownFloors, crownFloors, topX)
        break
      }
      case 'tower':
        topWidth = width * 0.82
        topDepth = depth * 0.86
        addSection(topWidth, topDepth, 2, remainingFloors)
        break
      case 'slab':
        addSection(width, depth, 2, remainingFloors)
        break
    }
    add('box', 'paint', palette.roof, topX, FOUNDATION_REVEAL + height + 1.7, topZ,
      topWidth * 0.38, 2.8, topDepth * 0.38)
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
    add('cylinder', 'window-lit', '#a5c2bd', 0, height + 2, 0, 3.9, 2.4, 3.9)
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
    buildingCount: plan.buildings.length + plan.commercialSites.length + plan.skyline.length,
    houseCount: plan.buildings.length,
    commercialSiteCount: plan.commercialSites.length,
    commercialPrimitiveCount,
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
  return (
    <>
      <primitive object={root} dispose={null} />
      {plan.lighthouse ? <LighthouseBeacon plan={plan.lighthouse} /> : null}
    </>
  )
}
