import {
	type AnyNode,
	pointInPolygon2D,
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
	InstancedBufferAttribute,
	InstancedMesh,
	Matrix4,
	Mesh,
	type Object3D,
	Quaternion,
	Vector3,
} from "three";
import * as TSL from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { mulberry32 } from "../variant-utils";
import {
	GLOBAL_WIND_STRENGTH,
	PLANT_WIND_FREQUENCY,
	PLANT_WIND_STRENGTH,
	setGlobalWindStrength,
} from "../wind-node";
import {
	DEFAULT_GRASS_PAINT_COLOR,
	resolveGrassPaintField,
	siteBounds,
	type GrassPaintField,
} from "./paint-field";
import {
	createGrassPaintTexture,
	disposeGrassPaintTexture,
} from "./paint-texture";
import {
	buildGrassObstacleField,
	collectSiteNodes,
} from "./obstacle-adapter";
import {
	createGrassObstacleTopology,
	MAX_GRASS_OBSTACLE_DISTANCE,
	type GrassObstacleField,
} from "./obstacle-field";
import {
	createGrassObstacleTexture,
	disposeGrassObstacleTexture,
	getGrassObstacleRuntime,
	updateGrassObstacleTexture,
} from "./obstacle-texture";
import { buildBladeGeometry } from "./render/blade-geometry";
import type { GrassFieldNode } from "./schema";
import { buildDrapedGroundGeometry } from "./terrain-drape";

const {
	abs,
	attribute,
	cameraPosition,
	cameraViewMatrix,
	clamp,
	cos,
	dot,
	Fn,
	max,
	mix,
	modelWorldMatrix,
	modelWorldMatrixInverse,
	mul,
	mx_noise_float,
	negate,
	normalize,
	normalWorldGeometry,
	positionGeometry,
	positionLocal,
	positionWorld,
	pow,
	sin,
	smoothstep,
	step,
	sub,
	texture,
	time,
	transformDirection,
	uniform,
	varying,
	vec2,
	vec3,
} = TSL;

const WIND_SPATIAL_FREQUENCY = 0.8;
const NOISE_SPATIAL_FREQUENCY = 0.35;
const NOISE_TIME_FREQUENCY = 0.18;
const MAX_WIND_WAVE = 1.8;
const MAX_TINT_ROTATION = Math.PI / 6;
const MAX_CONFIGURED_WIND_STRENGTH = 2;
const MAX_CONFIGURED_GRASS_WIND_INFLUENCE = 3;
const PERIPHERAL_TIP_BASE_MIX = 0.3;
const WIND_DIRECTION_WORLD = normalize(vec2(0.8, 0.6));
const NORMALIZED_BLADE_HEIGHT = clamp(positionGeometry.y, 0, 1);
export const GRASS_FIELD_WIND_INFLUENCE = uniform(1);

// Wave composition adapted to TSL from Cortiz Dev's MIT grass-field reference:
// https://github.com/cortiz2894/stylized-components
const grassFieldWind = Fn(() => {
	const displacedPosition = positionLocal.toVar();
	const windTime = time.mul(PLANT_WIND_FREQUENCY);
	const worldPosition = modelWorldMatrix.mul(displacedPosition).xyz;
	const alongWind = dot(worldPosition.xz, WIND_DIRECTION_WORLD);

	const primaryWave = sin(alongWind.mul(WIND_SPATIAL_FREQUENCY).add(windTime));
	const secondaryWave = sin(
		alongWind
			.mul(WIND_SPATIAL_FREQUENCY * 2.6)
			.add(windTime.mul(1.8))
			.add(1.3),
	).mul(0.35);
	const organicNoise = mx_noise_float(
		vec3(
			worldPosition.x.mul(NOISE_SPATIAL_FREQUENCY),
			worldPosition.z.mul(NOISE_SPATIAL_FREQUENCY),
			windTime.mul(NOISE_TIME_FREQUENCY),
		),
	);
	const gustEnvelope = organicNoise.mul(0.35).add(0.9);
	const turbulence = organicNoise.mul(0.2);

	const heightMask = NORMALIZED_BLADE_HEIGHT.mul(NORMALIZED_BLADE_HEIGHT);
	const displacement = displacedPosition.y
		.mul(PLANT_WIND_STRENGTH)
		.mul(GLOBAL_WIND_STRENGTH)
		.mul(GRASS_FIELD_WIND_INFLUENCE)
		.mul(heightMask)
		.mul(primaryWave.mul(gustEnvelope).add(secondaryWave).add(turbulence));

	// Position nodes run after instancing in Three r185, so converting the shared
	// world direction only through the mesh transform avoids per-blade yaw fan-out.
	const windDirectionWorld = vec3(
		WIND_DIRECTION_WORLD.x,
		0,
		WIND_DIRECTION_WORLD.y,
	);
	const windDirectionLocal = normalize(
		transformDirection(windDirectionWorld, modelWorldMatrixInverse),
	);
	displacedPosition.addAssign(windDirectionLocal.mul(displacement));

	return displacedPosition;
});
const GRASS_FIELD_WIND = grassFieldWind();
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

function createGroundPlane(
	boundary: ReadonlyArray<readonly [number, number]>,
	field: GrassPaintField,
	paintTexture: DataTexture,
	obstacleField: GrassObstacleField,
	obstacleTexture: DataTexture,
	density: Node<"float">,
	terrain: TerrainField | null,
): Mesh {
	const planeGeometry = buildDrapedGroundGeometry(boundary, terrain);

	const material = new MeshStandardNodeMaterial({
		depthWrite: false,
		side: DoubleSide,
		transparent: true,
	});
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
	const allowed = step(0.5, texture(obstacleTexture, obstacleUv).a);
	const opacity = painted.a.mul(density).mul(allowed);
	material.colorNode = painted.rgb;
	material.opacityNode = opacity;
	material.maskNode = opacity.greaterThan(1 / 255);

	const plane = new Mesh(planeGeometry, material);
	plane.userData.grassTerrainTopology = terrainTopologyKey(terrain);
	plane.name = "grass-field-ground";
	return plane;
}

export function buildGrassFieldGeometry(
	node: GrassFieldNode,
	context: GeometryContext,
): Group {
	const windStrength = (node.windStrength ?? 100) / 100;
	const grassWindInfluence = (node.grassWindInfluence ?? 100) / 100;
	setGlobalWindStrength(windStrength);
	GRASS_FIELD_WIND_INFLUENCE.value = grassWindInfluence;

	const site = context.parent;
	if (site?.type !== "site") {
		console.warn("Parent is not site for grass field, rendering nothing");
		return new Group();
	}

	const boundary = site.polygon.points;
	const terrain = terrainFieldOf(site);
	const bounds = siteBounds(boundary);
	const { minX, maxX, minZ, maxZ } = bounds;
	const cellSize = 0.1;
	const columns = Math.ceil((maxX - minX) / cellSize);
	const rows = Math.ceil((maxZ - minZ) / cellSize);
	const maxCandidateCount = columns * rows;
	const density = (node.density ?? 100) / 100;
	const widthVariation = (node.bladeWidthVariation ?? 20) / 100;
	const heightVariation = (node.bladeHeightVariation ?? 20) / 100;
	const tintVariation = (node.bladeTintVariation ?? 20) / 100;
	const tipBrightness = (node.bladeTipBrightness ?? 300) / 100;
	const grassFieldUniforms = {
		density: uniform(density),
		tintVariation: uniform(tintVariation),
		tipBrightness: uniform(tipBrightness),
		obstacleBendRadius: uniform(node.obstacleBendRadius ?? 0.75),
		obstacleBendStrength: uniform(node.obstacleBendStrength ?? 0.12),
		obstacleFlattening: uniform((node.obstacleFlattening ?? 60) / 100),
	};
	const paintField = resolveGrassPaintField(
		node.paintMap,
		bounds,
		DEFAULT_GRASS_PAINT_COLOR,
	);
	const paintTexture = createGrassPaintTexture(node.id, paintField);
	const siteNodes = collectSiteNodes(site, context.resolve);
	const obstacleField = buildGrassObstacleField(
		site,
		siteNodes,
		createGrassObstacleTopology(bounds),
	);
	const obstacleTexture = createGrassObstacleTexture(node.id, obstacleField);

	const geometry = buildBladeGeometry({
		width: node.bladeWidth,
		height: node.bladeHeight,
	});
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
	const obstacleDirection = normalize(
		vec3(
			sampledObstacle.g.mul(2).sub(1),
			0,
			sampledObstacle.b.mul(2).sub(1),
		),
	);
	const contactHeightMask = NORMALIZED_BLADE_HEIGHT.mul(
		NORMALIZED_BLADE_HEIGHT,
	);
	const contactedWind = mix(
		positionLocal,
		GRASS_FIELD_WIND,
		sub(1, obstacleInfluence.mul(0.75)),
	);
	const flattenedHeight = grassRoot.y.add(
		contactedWind.y
			.sub(grassRoot.y)
			.mul(
				sub(
					1,
					obstacleInfluence.mul(
						grassFieldUniforms.obstacleFlattening,
					),
				),
			),
	);
	const obstacleOffset = obstacleDirection
		.mul(grassFieldUniforms.obstacleBendStrength)
		.mul(obstacleInfluence)
		.mul(contactHeightMask);
	const contactedPosition = vec3(
		contactedWind.x.add(obstacleOffset.x),
		flattenedHeight,
		contactedWind.z.add(obstacleOffset.z),
	);
	const effectiveDensity = clamp(
		painted.a.mul(grassFieldUniforms.density),
		0,
		1,
	);
	const heightScale = effectiveDensity.mul(effectiveDensity);
	const visible = step(densityThreshold, effectiveDensity).mul(obstacleAllowed);
	const densityScaledPosition = vec3(
		contactedPosition.x,
		mix(grassRoot.y, contactedPosition.y, heightScale),
		contactedPosition.z,
	);

	const material = new MeshStandardNodeMaterial({ side: DoubleSide });
	material.positionNode = mix(grassRoot, densityScaledPosition, visible);
	material.addEventListener("dispose", () => {
		disposeGrassPaintTexture(node.id, paintTexture);
		disposeGrassObstacleTexture(node.id, obstacleTexture);
	});

	const sunDirection = normalize(vec3(-1, -1, -1));
	const bladeFacingSun = abs(dot(normalWorldGeometry, sunDirection));
	const edgeFactor = sub(1, bladeFacingSun);
	const viewDirection = normalize(sub(cameraPosition, positionWorld));
	const lookingThroughSun = max(dot(viewDirection, negate(sunDirection)), 0);
	const backFactor = pow(lookingThroughSun, 4);
	const transmissionMask = mul(edgeFactor, backFactor);
	const tipFactor = mix(1, NORMALIZED_BLADE_HEIGHT, 0.8);
	const tipBiasedTransmission = mul(transmissionMask, tipFactor);

	const sampledColor = painted.rgb;
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
	const tipColor = mix(sampledTipColor, variedBaseColor, peripheralBaseMix);
	const gradientFactor = smoothstep(0.2, 0.85, NORMALIZED_BLADE_HEIGHT);
	material.colorNode = mix(variedBaseColor, tipColor, gradientFactor);
	material.emissiveNode = mul(tipColor, mul(tipBiasedTransmission, 0.25));
	material.normalNode = transformDirection(vec3(0, 1, 0), cameraViewMatrix);

	const instancedBlades = new InstancedMesh(
		geometry,
		material,
		maxCandidateCount,
	);
	instancedBlades.name = "grass-field-blade";
	instancedBlades.userData.grassFieldUniforms = grassFieldUniforms;

	const rootValues = new Float32Array(maxCandidateCount * 3);
	const thresholdValues = new Float32Array(maxCandidateCount);
	const tintValues = new Float32Array(maxCandidateCount);
	const randomFn = mulberry32(1);
	const tintRandomFn = mulberry32(2);
	const matrix = new Matrix4();
	const position = new Vector3();
	const quaternion = new Quaternion();
	const scale = new Vector3();
	const up = new Vector3(0, 1, 0);

	let acceptedCount = 0;
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const cellX = minX + column * cellSize;
			const cellZ = minZ + row * cellSize;
			const x = cellX + randomFn() * cellSize;
			const z = cellZ + randomFn() * cellSize;
			const yaw = randomFn() * Math.PI * 2;
			const widthFactor = 1 + (randomFn() * 2 - 1) * widthVariation;
			const heightFactor = 1 + (randomFn() * 2 - 1) * heightVariation;
			const threshold = randomFn();
			const tint = tintRandomFn() * 2 - 1;

			if (!pointInPolygon2D([x, z], boundary)) continue;

			const y = terrain ? surfaceHeightAt(terrain, x, z) : 0;
			position.set(x, y, z);
			quaternion.setFromAxisAngle(up, yaw);
			scale.set(
				node.bladeWidth * widthFactor,
				node.bladeHeight * heightFactor,
				1,
			);
			matrix.compose(position, quaternion, scale);
			instancedBlades.setMatrixAt(acceptedCount, matrix);
			rootValues[acceptedCount * 3] = x;
			rootValues[acceptedCount * 3 + 1] = y;
			rootValues[acceptedCount * 3 + 2] = z;
			thresholdValues[acceptedCount] = threshold;
			tintValues[acceptedCount] = tint;
			acceptedCount += 1;
		}
	}

	geometry.setAttribute(
		"grassRoot",
		new InstancedBufferAttribute(rootValues.slice(0, acceptedCount * 3), 3),
	);
	geometry.setAttribute(
		"grassDensityThreshold",
		new InstancedBufferAttribute(thresholdValues.slice(0, acceptedCount), 1),
	);
	geometry.setAttribute(
		"grassTintVariation",
		new InstancedBufferAttribute(tintValues.slice(0, acceptedCount), 1),
	);
	instancedBlades.count = acceptedCount;
	instancedBlades.instanceMatrix.needsUpdate = true;

	const maxWindOffset =
		node.bladeHeight *
			(1 + heightVariation) *
			PLANT_WIND_STRENGTH *
			MAX_CONFIGURED_WIND_STRENGTH *
			MAX_CONFIGURED_GRASS_WIND_INFLUENCE *
			MAX_WIND_WAVE +
		(node.obstacleBendStrength ?? 0.12);
	instancedBlades.userData.grassMaxWindOffset = maxWindOffset;
	instancedBlades.computeBoundingBox();
	instancedBlades.boundingBox?.expandByScalar(maxWindOffset);
	instancedBlades.computeBoundingSphere();
	if (
		instancedBlades.boundingSphere &&
		instancedBlades.boundingSphere.radius >= 0
	) {
		instancedBlades.boundingSphere.radius += maxWindOffset;
	}

	const group = new Group();
	group.add(instancedBlades);
	group.add(
		createGroundPlane(
			boundary,
			paintField,
			paintTexture,
			obstacleField,
			obstacleTexture,
			grassFieldUniforms.density,
			terrain,
		),
	);
	return group;
}

export function updateGrassFieldTerrain(
	root: Object3D,
	site: SiteNode,
): boolean {
	const blade = root.getObjectByName("grass-field-blade");
	const ground = root.getObjectByName("grass-field-ground");
	if (!(blade instanceof InstancedMesh) || !(ground instanceof Mesh))
		return false;

	const terrain = terrainFieldOf(site);
	const roots = blade.geometry.getAttribute("grassRoot");
	const matrix = new Matrix4();
	const position = new Vector3();
	const rotation = new Quaternion();
	const scale = new Vector3();

	for (let index = 0; index < blade.count; index += 1) {
		const x = roots.getX(index);
		const z = roots.getZ(index);
		const y = terrain ? surfaceHeightAt(terrain, x, z) : 0;
		roots.setY(index, y);
		blade.getMatrixAt(index, matrix);
		matrix.decompose(position, rotation, scale);
		position.y = y;
		matrix.compose(position, rotation, scale);
		blade.setMatrixAt(index, matrix);
	}
	roots.needsUpdate = true;
	blade.instanceMatrix.needsUpdate = true;
	blade.computeBoundingBox();
	const maxWindOffset = blade.userData.grassMaxWindOffset;
	if (typeof maxWindOffset === "number")
		blade.boundingBox?.expandByScalar(maxWindOffset);
	blade.computeBoundingSphere();
	if (
		typeof maxWindOffset === "number" &&
		blade.boundingSphere &&
		blade.boundingSphere.radius >= 0
	) {
		blade.boundingSphere.radius += maxWindOffset;
	}

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
				tintVariation: { value: number };
				tipBrightness: { value: number };
				obstacleBendRadius: { value: number };
				obstacleBendStrength: { value: number };
				obstacleFlattening: { value: number };
		  }
		| undefined;
	if (!uniforms) return false;

	uniforms.density.value = (node.density ?? 100) / 100;
	uniforms.tintVariation.value = (node.bladeTintVariation ?? 20) / 100;
	uniforms.tipBrightness.value = (node.bladeTipBrightness ?? 300) / 100;
	uniforms.obstacleBendRadius.value = node.obstacleBendRadius ?? 0.75;
	uniforms.obstacleBendStrength.value = node.obstacleBendStrength ?? 0.12;
	uniforms.obstacleFlattening.value = (node.obstacleFlattening ?? 60) / 100;
	setGlobalWindStrength((node.windStrength ?? 100) / 100);
	GRASS_FIELD_WIND_INFLUENCE.value = (node.grassWindInfluence ?? 100) / 100;
	return true;
}
