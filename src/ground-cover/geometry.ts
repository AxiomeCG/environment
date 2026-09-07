import {
	type AnyNode,
	normalAt,
	surfaceHeightAt,
	terrainFieldOf,
	type GeometryContext,
	type SiteNode,
	type TerrainField,
} from "@pascal-app/core";
import {
	DoubleSide,
	type DataTexture,
	Group,
	Mesh,
	type Object3D,
} from "three";
import * as TSL from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { setGlobalWindStrength } from "../wind-node";
import { buildSurfaceUnderlayColorNodes } from "../surface-material/materials";
import {
	resolveSurfaceMaterial,
	surfaceMaterialNodeOfSite,
} from "../surface-material/field-context";
import {
	createSurfacePaintTexture,
	disposeSurfacePaintTexture,
} from "../surface-material/texture";
import type { SurfaceMaterialField } from "../surface-material/field";
import { type GrassPaintField } from "./paint-field";
import {
	createGrassHeightTexture,
	disposeGrassHeightTexture,
} from "./height-texture";
import {
	createGrassPaintTexture,
	disposeGrassPaintTexture,
} from "./paint-texture";
import { buildGrassObstacleField } from "./obstacle-adapter";
import {
	MAX_GRASS_OBSTACLE_DISTANCE,
	type GrassObstacleField,
} from "./obstacle-field";
import {
	createGrassObstacleTexture,
	disposeGrassObstacleTexture,
	getGrassObstacleRuntime,
	updateGrassObstacleTexture,
} from "./obstacle-texture";
import { resolveGroundCoverFields } from "./field-context";
import {
	createGrassBladePosition,
	createGrassBladeShading,
	GRASS_BLADE_PROGRESS,
} from "./render/blade-nodes";
import {
	createGrassTiles,
	updateGrassTileTerrain,
	visitGrassTileMeshes,
} from "./render/grass-tiles";
import type { GrassFieldNode } from "./schema";
import { buildDrapedGroundGeometry } from "./terrain-drape";

const {
	attribute,
	cameraViewMatrix,
	clamp,
	cos,
	dot,
	max,
	length,
	mix,
	positionGeometry,
	sin,
	smoothstep,
	step,
	sub,
	texture,
	transformDirection,
	uniform,
	varying,
	vec2,
	vec3,
} = TSL;

const MAX_TINT_ROTATION = Math.PI / 6;

const PERIPHERAL_TIP_BASE_MIX = 0.3;
const SURFACE_ROOT_BLEND_END = 0.35;
const SURFACE_GROUND_TEXTURE_MIX = 0.25;
const SURFACE_BLADE_SAMPLE_FILTER = 3;
const GRASS_COVERAGE_START = 0.05;
const SURFACE_EDGE_TEXTURE_MIX = 0.6;
const varyingFloat = varying as unknown as (
	node: Node<"float">,
	name: string,
) => Node<"float">;
const varyingVec4 = varying as unknown as (
	node: Node<"vec4">,
	name: string,
) => Node<"vec4">;
function terrainTopologyKey(terrain: TerrainField | null): string {
	return terrain
		? `${terrain.origin[0]}:${terrain.origin[1]}:${terrain.spacing}:${terrain.cols}:${terrain.rows}`
		: "flat";
}
type GroundTextureNodes = {
	color: Node<"vec3">;
	coverage: Node<"float">;
};

type GroundTextureSource = {
	field: SurfaceMaterialField;
	paintTexture: DataTexture;
	textureSize: number;
};

function blendGroundPlaneColor(
	paintColor: Node<"vec3">,
	surface: GroundTextureNodes | null,
): Node<"vec3"> {
	return surface
		? mix(
				paintColor,
				surface.color,
				surface.coverage.mul(SURFACE_GROUND_TEXTURE_MIX),
			)
		: paintColor;
}
function shapeGrassCoverage(coverage: Node<"float">): Node<"float"> {
	return smoothstep(GRASS_COVERAGE_START, 1, clamp(coverage, 0, 1));
}

function blendBladeRootColor(
	paintColor: Node<"vec3">,
	surface: GroundTextureNodes | null,
	density: Node<"float">,
): Node<"vec3"> {
	return surface
		? mix(
				paintColor,
				surface.color,
				surface.coverage.mul(
					mix(
						SURFACE_EDGE_TEXTURE_MIX,
						SURFACE_GROUND_TEXTURE_MIX,
						density,
					),
				),
			)
		: paintColor;
}

function createGroundPlane(
	boundary: ReadonlyArray<readonly [number, number]>,
	field: GrassPaintField,
	paintTexture: DataTexture,
	obstacleField: GrassObstacleField,
	obstacleTexture: DataTexture,
	density: Node<"float">,
	surface: GroundTextureSource | null,
	terrain: TerrainField | null,
	onDispose: () => void,
): Mesh {
	const planeGeometry = buildDrapedGroundGeometry(boundary, terrain);

	const material = new MeshStandardNodeMaterial({
		depthWrite: false,
		side: DoubleSide,
		transparent: true,
	});
	material.addEventListener("dispose", onDispose);
	const paintSize = vec2(
		Math.max((field.cols - 1) * field.spacing, field.spacing),
		Math.max((field.rows - 1) * field.spacing, field.spacing),
	);
	const paintUv = positionGeometry.xz
		.sub(vec2(field.origin[0], field.origin[1]))
		.div(paintSize);
	const obstacleSize = vec2(
		Math.max(
			(obstacleField.cols - 1) * obstacleField.spacing,
			obstacleField.spacing,
		),
		Math.max(
			(obstacleField.rows - 1) * obstacleField.spacing,
			obstacleField.spacing,
		),
	);
	const obstacleUv = positionGeometry.xz
		.sub(vec2(obstacleField.origin[0], obstacleField.origin[1]))
		.div(obstacleSize);
	const painted = texture(paintTexture, paintUv);
	const paintColor = painted.rgb.div(max(painted.a, 1 / 255));
	const allowed = step(0.5, texture(obstacleTexture, obstacleUv).a);
	const opacity = shapeGrassCoverage(
		painted.a.mul(density).mul(allowed),
	);
	const surfaceNodes = surface
		? buildSurfaceUnderlayColorNodes(
				positionGeometry.xz,
				surface.paintTexture,
				surface.field,
				surface.textureSize,
			)
		: null;
	material.colorNode = blendGroundPlaneColor(paintColor, surfaceNodes);
	material.opacityNode = opacity;
	material.maskNode = opacity.greaterThan(1 / 255);
	material.normalNode = transformDirection(vec3(0, 1, 0), cameraViewMatrix);

	const plane = new Mesh(planeGeometry, material);
	plane.renderOrder = 1;
	plane.userData.grassTerrainTopology = terrainTopologyKey(terrain);
	plane.name = "grass-field-ground";
	return plane;
}

export function buildGrassFieldGeometry(
	node: GrassFieldNode,
	context: GeometryContext,
): Group {
	const windStrength = (node.windStrength ?? 100) / 100;
	setGlobalWindStrength(windStrength);

	const fields = resolveGroundCoverFields(node, context);
	if (!fields) {
		console.warn("Parent is not site for grass field, rendering nothing");
		return new Group();
	}

	const {
		site,
		boundary,
		bounds,
		terrain,
		paint: paintField,
		height: heightField,
		obstacles: obstacleField,
	} = fields;
	const density = (node.density ?? 100) / 100;
	const tintVariation = (node.bladeTintVariation ?? 20) / 100;
	const tipBrightness = (node.bladeTipBrightness ?? 300) / 100;
	const grassFieldUniforms = {
		density: uniform(density),
		restBend: uniform(node.bladeRestBend ?? 0.22),
		windInfluence: uniform((node.grassWindInfluence ?? 100) / 100),
		tintVariation: uniform(tintVariation),
		tipBrightness: uniform(tipBrightness),
		obstacleBendRadius: uniform(node.obstacleBendRadius ?? 0.75),
		obstacleBendStrength: uniform(node.obstacleBendStrength ?? 0.12),
		obstacleFlattening: uniform((node.obstacleFlattening ?? 60) / 100),
	};
	const paintTexture = createGrassPaintTexture(node.id, paintField);
	const heightTexture = createGrassHeightTexture(node.id, heightField);
	const obstacleTexture = createGrassObstacleTexture(node.id, obstacleField);
	const surfaceNode = surfaceMaterialNodeOfSite(site, context);
	const surface = surfaceNode ? resolveSurfaceMaterial(surfaceNode, context) : null;
	const surfacePaintTexture = surface
		? createSurfacePaintTexture(surface.node.id, surface.field)
		: null;

	const grassRoot = attribute<"vec3">("grassRoot", "vec3");
	const densityThreshold = attribute<"float">("grassDensityThreshold", "float");
	const tintRandom = varyingFloat(
		attribute<"float">("grassTintVariation", "float"),
		"vGrassTintVariation",
	);
	const fieldSize = vec2(
		Math.max((paintField.cols - 1) * paintField.spacing, paintField.spacing),
		Math.max((paintField.rows - 1) * paintField.spacing, paintField.spacing),
	);
	const paintUv = grassRoot.xz
		.sub(vec2(paintField.origin[0], paintField.origin[1]))
		.div(fieldSize);
	const heightSize = vec2(
		Math.max((heightField.cols - 1) * heightField.spacing, heightField.spacing),
		Math.max((heightField.rows - 1) * heightField.spacing, heightField.spacing),
	);
	const surfaceSampleBasis = attribute<"vec2">("grassSurfaceSampleBasis", "vec2");
	const heightUv = grassRoot.xz
		.sub(vec2(heightField.origin[0], heightField.origin[1]))
		.div(heightSize);
	const obstacleSize = vec2(
		Math.max(
			(obstacleField.cols - 1) * obstacleField.spacing,
			obstacleField.spacing,
		),
		Math.max(
			(obstacleField.rows - 1) * obstacleField.spacing,
			obstacleField.spacing,
		),
	);
	const obstacleUv = grassRoot.xz
		.sub(vec2(obstacleField.origin[0], obstacleField.origin[1]))
		.div(obstacleSize);
	const sampledPaint = texture(paintTexture, paintUv) as Node<"vec4">;
	const painted = varyingVec4(sampledPaint, "vGrassPaint");
	const encodedHeight = texture(heightTexture, heightUv).r.mul(255);
	const lowerHeightScale = encodedHeight.div(128);
	const upperHeightScale = encodedHeight.sub(128).div(127).add(1);
	const localHeightScale = mix(
		lowerHeightScale,
		upperHeightScale,
		step(128, encodedHeight),
	);
	const surfaceSamplePosition = grassRoot.xz.add(
		vec2(
			positionGeometry.x
				.mul(surfaceSampleBasis.x)
				.add(positionGeometry.z.mul(surfaceSampleBasis.y)),
			positionGeometry.z
				.mul(surfaceSampleBasis.x)
				.sub(positionGeometry.x.mul(surfaceSampleBasis.y)),
		),
	);
	const surfaceUnderlay =
		surface && surfacePaintTexture
			? buildSurfaceUnderlayColorNodes(
					surfaceSamplePosition,
					surfacePaintTexture,
					surface.field,
					surface.node.textureSize,
					surfaceSamplePosition.mul(SURFACE_BLADE_SAMPLE_FILTER),
				)
			: null;
	const sampledObstacle = texture(obstacleTexture, obstacleUv) as Node<"vec4">;
	const obstacleAllowed = step(0.5, sampledObstacle.a);
	const obstacleEnabled = step(0.001, grassFieldUniforms.obstacleBendRadius);
	const obstacleDistance = sampledObstacle.r.mul(
		MAX_GRASS_OBSTACLE_DISTANCE,
	);
	const obstacleInfluence = sub(
		1,
		smoothstep(
			0,
			max(grassFieldUniforms.obstacleBendRadius, 0.001),
			obstacleDistance,
		),
	)
		.mul(obstacleAllowed)
		.mul(obstacleEnabled);
	const obstacleDirectionVector = vec3(
		sampledObstacle.g.mul(2).sub(1),
		0,
		sampledObstacle.b.mul(2).sub(1),
	);
	const obstacleDirection = obstacleDirectionVector.div(
		max(length(obstacleDirectionVector), 1e-5),
	);
	const effectiveDensity = shapeGrassCoverage(
		painted.a.mul(grassFieldUniforms.density),
	);
	const densityHeightScale = effectiveDensity.mul(effectiveDensity);
	const flatteningScale = clamp(
		sub(
			1,
			obstacleInfluence.mul(
				clamp(grassFieldUniforms.obstacleFlattening, 0, 1),
			),
		),
		0,
		1,
	);
	const effectiveHeightScale = localHeightScale
		.mul(densityHeightScale)
		.mul(flatteningScale);
	const curvedPosition = createGrassBladePosition({
		heightScale: effectiveHeightScale,
		restBend: grassFieldUniforms.restBend,
		windInfluence: grassFieldUniforms.windInfluence,
		obstacleInfluence,
		obstacleDirection,
		obstacleBendStrength: grassFieldUniforms.obstacleBendStrength,
	});
	const visible = step(densityThreshold, effectiveDensity).mul(obstacleAllowed);

	const material = new MeshStandardNodeMaterial({ side: DoubleSide });
	material.positionNode = curvedPosition;
	material.maskNode = visible.greaterThan(0.5);
	const disposeFieldTextures = () => {
		disposeGrassPaintTexture(node.id, paintTexture);
		disposeGrassHeightTexture(node.id, heightTexture);
		disposeGrassObstacleTexture(node.id, obstacleTexture);
		if (surface && surfacePaintTexture) {
			disposeSurfacePaintTexture(surface.node.id, surfacePaintTexture);
		}
	};

	const grassBladeShading = createGrassBladeShading(tintRandom);
	const sampledColor = painted.rgb.div(max(painted.a, 1 / 255));
	const groundSampleColor = blendBladeRootColor(
		sampledColor,
		surfaceUnderlay,
		effectiveDensity,
	);
	const tintAngle = tintRandom
		.mul(grassFieldUniforms.tintVariation)
		.mul(MAX_TINT_ROTATION);
	const hueCos = cos(tintAngle);
	const hueSin = sin(tintAngle);
	const variedBaseColor = clamp(
		vec3(
			dot(
				sampledColor,
				vec3(
					hueCos.mul(0.787).sub(hueSin.mul(0.213)).add(0.213),
					hueCos.mul(-0.715).add(hueSin.mul(-0.715)).add(0.715),
					hueCos.mul(-0.072).add(hueSin.mul(0.928)).add(0.072),
				),
			),
			dot(
				sampledColor,
				vec3(
					hueCos.mul(-0.213).add(hueSin.mul(0.143)).add(0.213),
					hueCos.mul(0.285).add(hueSin.mul(0.14)).add(0.715),
					hueCos.mul(-0.072).add(hueSin.mul(-0.283)).add(0.072),
				),
			),
			dot(
				sampledColor,
				vec3(
					hueCos.mul(-0.213).add(hueSin.mul(-0.787)).add(0.213),
					hueCos.mul(-0.715).add(hueSin.mul(0.715)).add(0.715),
					hueCos.mul(0.928).add(hueSin.mul(0.072)).add(0.072),
				),
			),
		),
		0,
		1,
	);
	const sampledTipColor = variedBaseColor.mul(grassFieldUniforms.tipBrightness);
	const peripheralBaseMix = sub(1, painted.a).mul(PERIPHERAL_TIP_BASE_MIX);
	const tipColor = mix(
		sampledTipColor,
		variedBaseColor,
		peripheralBaseMix,
	);
	const gradientFactor = smoothstep(0.2, 0.85, GRASS_BLADE_PROGRESS);
	const grassBladeColor = mix(variedBaseColor, tipColor, gradientFactor);
	const groundRootBlend = sub(
		1,
		smoothstep(0, SURFACE_ROOT_BLEND_END, GRASS_BLADE_PROGRESS),
	);
	const finalBladeColor = mix(
		grassBladeColor.mul(grassBladeShading.rootShade),
		groundSampleColor,
		groundRootBlend,
	);
	material.colorNode = finalBladeColor;
	material.emissiveNode = tipColor
		.mul(grassBladeShading.transmission)
		.mul(sub(1, groundRootBlend));
	material.normalNode = grassBladeShading.normal;

	const group = createGrassTiles(node, boundary, bounds, terrain, material);
	visitGrassTileMeshes(group, (blade) => {
		blade.userData.grassFieldUniforms = grassFieldUniforms;
	});
	group.add(
		createGroundPlane(
			boundary,
			paintField,
			paintTexture,
			obstacleField,
			obstacleTexture,
			grassFieldUniforms.density,
			surface && surfacePaintTexture
				? {
						field: surface.field,
						paintTexture: surfacePaintTexture,
						textureSize: surface.node.textureSize,
					}
				: null,
			terrain,
			disposeFieldTextures,
		),
	);
	return group;
}

export function updateGrassFieldTerrain(
	root: Object3D,
	site: SiteNode,
): boolean {
	const ground = root.getObjectByName("grass-field-ground");
	if (!(ground instanceof Mesh)) return false;

	const terrain = terrainFieldOf(site);
	if (!updateGrassTileTerrain(root, terrain)) return false;

	const nextTopology = terrainTopologyKey(terrain);
	if (ground.userData.grassTerrainTopology === nextTopology) {
		const positions = ground.geometry.getAttribute("position");
		const normals = ground.geometry.getAttribute("normal");
		for (let index = 0; index < positions.count; index += 1) {
			const x = positions.getX(index);
			const z = positions.getZ(index);
			positions.setY(
				index,
				terrain ? surfaceHeightAt(terrain, x, z) + 0.005 : 0.005,
			);
			const [nx, ny, nz] = terrain ? normalAt(terrain, x, z) : [0, 1, 0];
			normals.setXYZ(index, nx, ny, nz);
		}
		positions.needsUpdate = true;
		normals.needsUpdate = true;
		ground.geometry.computeBoundingBox();
		ground.geometry.computeBoundingSphere();
	} else {
		const previousGeometry = ground.geometry;
		ground.geometry = buildDrapedGroundGeometry(site.polygon.points, terrain);
		ground.userData.grassTerrainTopology = nextTopology;
		previousGeometry.dispose();
	}

	return true;
}
export function updateGrassFieldObstacles(
	node: GrassFieldNode,
	site: SiteNode,
	nodes: Readonly<Record<string, AnyNode>>,
): boolean {
	const runtime = getGrassObstacleRuntime(node.id);
	if (!runtime) return false;
	const field = buildGrassObstacleField(site, nodes, runtime.field);
	return updateGrassObstacleTexture(node.id, field);
}


export function updateGrassFieldUniforms(
	root: Object3D,
	node: GrassFieldNode,
): boolean {
	const blade = root.getObjectByName("grass-field-blade");
	const uniforms = blade?.userData.grassFieldUniforms as
		| {
				density: { value: number };
				restBend: { value: number };
				windInfluence: { value: number };
				tintVariation: { value: number };
				tipBrightness: { value: number };
				obstacleBendRadius: { value: number };
				obstacleBendStrength: { value: number };
				obstacleFlattening: { value: number };
		  }
		| undefined;
	if (!uniforms) return false;

	uniforms.density.value = (node.density ?? 100) / 100;
	uniforms.restBend.value = node.bladeRestBend ?? 0.22;
	uniforms.windInfluence.value = (node.grassWindInfluence ?? 100) / 100;
	uniforms.tintVariation.value = (node.bladeTintVariation ?? 20) / 100;
	uniforms.tipBrightness.value = (node.bladeTipBrightness ?? 300) / 100;
	uniforms.obstacleBendRadius.value = node.obstacleBendRadius ?? 0.75;
	uniforms.obstacleBendStrength.value = node.obstacleBendStrength ?? 0.12;
	uniforms.obstacleFlattening.value = (node.obstacleFlattening ?? 60) / 100;
	setGlobalWindStrength((node.windStrength ?? 100) / 100);
	return true;
}
