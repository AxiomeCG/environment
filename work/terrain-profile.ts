import { SiteNode, terrainFieldOf } from '@pascal-app/core'
import { deriveBoundarySegments } from '../src/surroundings/frontages'
import { deriveSurroundingsLayout, deriveSurroundingsLevelTerrainDistance, STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS } from '../src/surroundings/corridor'
import { createExteriorTerrainSampler, createRenderedTerrainSampler, createTerrainSubdivisionSampler, deriveExteriorTerrainSectionAddresses, buildExteriorTerrainSection, mergeExteriorTerrainSections } from '../src/surroundings/exterior-terrain'
import { deriveOuterRoads } from '../src/surroundings/outer-roads'
import { deriveRuntimeRoadNetwork } from '../src/surroundings/runtime-road-graph'
import { createRoadGradedTerrain } from '../src/surroundings/road-elevation'
import { createRiverLandscape } from '../src/surroundings/river-landscape'
import { deriveLandscapeRegion } from '../src/surroundings/landscape-region'

const site = SiteNode.parse({ id: 'site_terrain_profile', polygon: { type: 'polygon', points: [[-15,-15],[15,-15],[15,15],[-15,15]] }, children: [] })
const addresses = deriveExteriorTerrainSectionAddresses(site.polygon.points)
const segments = deriveBoundarySegments({ points: site.polygon.points, contexts: Object.fromEntries([0,1,2,3].map(i => [i,{separator:'secondary-road',access:'none'}])) })
const samples: Record<string,number>[] = []
for (let repeat = 0; repeat < 8; repeat++) {
  const seed = ['pascal-suburbs','willow-creek','terrain-profile-1','terrain-profile-2'][repeat % 4]!
  let start = performance.now()
  const layout = deriveSurroundingsLayout(segments, STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS, { seed, depthVariation: .2 })
  const distance = deriveSurroundingsLevelTerrainDistance(segments, layout, STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS)
  const terrain = createExteriorTerrainSampler({boundary:site.polygon.points, terrain:terrainFieldOf(site), levelTerrainDistance: distance, seed})
  const landscape = createRiverLandscape(site, [], terrain, deriveLandscapeRegion(seed))
  const roads = deriveOuterRoads(layout,{seed,heightAt:terrain.heightAt})
  const network = deriveRuntimeRoadNetwork(layout,roads)
  const topology = performance.now()-start
  start = performance.now()
  const graded = createRoadGradedTerrain(network,landscape.sampler,site.polygon.points,landscape.waterLevelAt)
  let heightCalls=0
  const source = {...graded, heightAt:(x:number,z:number)=>{heightCalls++;return graded.heightAt(x,z)}}
  const sampler = createRenderedTerrainSampler(process.argv.includes('--adaptive') ? createTerrainSubdivisionSampler(source,site.polygon.points) : source,addresses)
  const grade = performance.now()-start
  start = performance.now()
  const sectionTimes: {key:string;ms:number;triangles:number}[]=[]
  const sections = addresses.map(address=>{const start=performance.now(); const section=buildExteriorTerrainSection(address,sampler,site.polygon.points);sectionTimes.push({key:address.key,ms:performance.now()-start,triangles:section.indices.length/3});return section})
  if(process.argv.includes('--detail') && repeat===7) console.log(sectionTimes.sort((a,b)=>b.ms-a.ms).slice(0,16))
  const mesh = mergeExteriorTerrainSections(sections)
  const geometry = performance.now()-start
  const sample = {topology,grade,geometry,total:topology+grade+geometry,sections:sections.length,triangles:mesh.triangleCount,bytes:mesh.ownedBufferBytes,heightCalls}
  console.log(JSON.stringify({seed,...sample}))
  if(repeat>=4) samples.push(sample)
}
const report=Object.fromEntries(Object.keys(samples[0]!).map(key=>{const values=samples.map(sample=>sample[key]!).sort((a,b)=>a-b);return [key,{median:values[Math.floor(values.length/2)],p95:values[Math.ceil(values.length*.95)-1]}]}))
console.log(JSON.stringify({report},null,2))
if(process.argv[2]) await Bun.write(process.argv[2],JSON.stringify({samples,report},null,2))
if(report.total!.p95!>100) {console.error('Terrain generation exceeds the 100 ms CPU target');process.exitCode=1}
