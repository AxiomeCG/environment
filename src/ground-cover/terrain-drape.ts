import { normalAt, surfaceHeightAt, type TerrainField } from "@pascal-app/core";
import {
	BufferGeometry,
	Float32BufferAttribute,
	ShapeUtils,
	Vector2,
} from "three";

type Point2 = readonly [number, number];

const CLIP_EPSILON = 1e-9;
const GROUND_OFFSET = 0.005;

export function buildDrapedGroundGeometry(
	boundary: ReadonlyArray<Point2>,
	field: TerrainField | null,
): BufferGeometry {
	const geometry = new BufferGeometry();
	if (boundary.length < 3) return geometry;

	const contour = boundary.map(([x, z]) => new Vector2(x, z));
	const siteTriangles = ShapeUtils.triangulateShape(contour, []);
	// CCW triangles in XY face downward after mapping their Y coordinate to Z.
	for (const triangle of siteTriangles) triangle.reverse();
	const positions: number[] = [];
	const normals: number[] = [];

	if (!field) {
		for (const triangle of siteTriangles) {
			for (const index of triangle) {
				const [x, z] = boundary[index] as Point2;
				positions.push(x, GROUND_OFFSET, z);
				normals.push(0, 1, 0);
			}
		}
	} else {
		const bounds = boundaryBounds(boundary);
		const xs = terrainGridCoordinates(
			bounds.minX,
			bounds.maxX,
			field.origin[0],
			field.spacing,
			field.cols,
		);
		const zs = terrainGridCoordinates(
			bounds.minZ,
			bounds.maxZ,
			field.origin[1],
			field.spacing,
			field.rows,
		);

		for (const triangle of siteTriangles) {
			const siteTriangle = triangle.map((index) => boundary[index] as Point2);
			const triangleBounds = boundaryBounds(siteTriangle);

			for (let zIndex = 0; zIndex < zs.length - 1; zIndex += 1) {
				const z0 = zs[zIndex] as number;
				const z1 = zs[zIndex + 1] as number;
				if (z1 < triangleBounds.minZ || z0 > triangleBounds.maxZ) continue;

				for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
					const x0 = xs[xIndex] as number;
					const x1 = xs[xIndex + 1] as number;
					if (x1 < triangleBounds.minX || x0 > triangleBounds.maxX) continue;

					appendIntersection(
						siteTriangle,
						[
							[x0, z0],
							[x0, z1],
							[x1, z0],
						],
						field,
						positions,
						normals,
					);
					appendIntersection(
						siteTriangle,
						[
							[x1, z0],
							[x0, z1],
							[x1, z1],
						],
						field,
						positions,
						normals,
					);
				}
			}
		}
	}

	const uvs: number[] = [];
	for (let index = 0; index < positions.length; index += 3) {
		uvs.push(positions[index] as number, positions[index + 2] as number);
	}
	geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
	geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
	geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return geometry;
}

function appendIntersection(
	siteTriangle: Point2[],
	terrainTriangle: Point2[],
	field: TerrainField,
	positions: number[],
	normals: number[],
): void {
	const polygon = clipToConvexPolygon(siteTriangle, terrainTriangle);
	if (polygon.length < 3 || Math.abs(signedArea(polygon)) <= CLIP_EPSILON)
		return;

	const first = polygon[0] as Point2;
	for (let index = 1; index < polygon.length - 1; index += 1) {
		appendVertex(first, field, positions, normals);
		appendVertex(polygon[index] as Point2, field, positions, normals);
		appendVertex(polygon[index + 1] as Point2, field, positions, normals);
	}
}

function appendVertex(
	[x, z]: Point2,
	field: TerrainField,
	positions: number[],
	normals: number[],
): void {
	const y = surfaceHeightAt(field, x, z);
	const [nx, ny, nz] = normalAt(field, x, z);
	positions.push(x, y + GROUND_OFFSET, z);
	normals.push(nx, ny, nz);
}

function terrainGridCoordinates(
	min: number,
	max: number,
	origin: number,
	spacing: number,
	count: number,
): number[] {
	if (max - min <= CLIP_EPSILON) return [min];

	const coordinates = [min];
	const first = Math.max(0, Math.ceil((min - origin) / spacing));
	const last = Math.min(count - 1, Math.floor((max - origin) / spacing));

	for (let index = first; index <= last; index += 1) {
		const coordinate = origin + index * spacing;
		if (coordinate > min + CLIP_EPSILON && coordinate < max - CLIP_EPSILON) {
			coordinates.push(coordinate);
		}
	}

	coordinates.push(max);
	return coordinates;
}

function clipToConvexPolygon(subject: Point2[], clipper: Point2[]): Point2[] {
	let output = subject;
	const orientation = Math.sign(signedArea(clipper)) || 1;

	for (let index = 0; index < clipper.length && output.length > 0; index += 1) {
		const clipStart = clipper[index] as Point2;
		const clipEnd = clipper[(index + 1) % clipper.length] as Point2;
		const input = output;
		output = [];
		let previous = input[input.length - 1] as Point2;
		let previousInside = isInside(previous, clipStart, clipEnd, orientation);

		for (const current of input) {
			const currentInside = isInside(current, clipStart, clipEnd, orientation);
			if (currentInside !== previousInside) {
				output.push(lineIntersection(previous, current, clipStart, clipEnd));
			}
			if (currentInside) output.push(current);
			previous = current;
			previousInside = currentInside;
		}

		output = deduplicatePolygon(output);
	}

	return output;
}

function isInside(
	point: Point2,
	start: Point2,
	end: Point2,
	orientation: number,
): boolean {
	return orientation * cross(start, end, point) >= -CLIP_EPSILON;
}

function lineIntersection(
	start: Point2,
	end: Point2,
	clipStart: Point2,
	clipEnd: Point2,
): Point2 {
	const rx = end[0] - start[0];
	const rz = end[1] - start[1];
	const sx = clipEnd[0] - clipStart[0];
	const sz = clipEnd[1] - clipStart[1];
	const denominator = rx * sz - rz * sx;
	if (Math.abs(denominator) <= CLIP_EPSILON) return end;

	const t =
		((clipStart[0] - start[0]) * sz - (clipStart[1] - start[1]) * sx) /
		denominator;
	return [start[0] + t * rx, start[1] + t * rz];
}

function deduplicatePolygon(points: Point2[]): Point2[] {
	const deduplicated: Point2[] = [];
	for (const point of points) {
		const previous = deduplicated[deduplicated.length - 1];
		if (!previous || !pointsEqual(previous, point)) deduplicated.push(point);
	}
	if (
		deduplicated.length > 1 &&
		pointsEqual(deduplicated[0] as Point2, deduplicated.at(-1) as Point2)
	) {
		deduplicated.pop();
	}
	return deduplicated;
}

function pointsEqual(left: Point2, right: Point2): boolean {
	return (
		Math.abs(left[0] - right[0]) <= CLIP_EPSILON &&
		Math.abs(left[1] - right[1]) <= CLIP_EPSILON
	);
}

function cross(start: Point2, end: Point2, point: Point2): number {
	return (
		(end[0] - start[0]) * (point[1] - start[1]) -
		(end[1] - start[1]) * (point[0] - start[0])
	);
}

function signedArea(points: ReadonlyArray<Point2>): number {
	let area = 0;
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index] as Point2;
		const next = points[(index + 1) % points.length] as Point2;
		area += current[0] * next[1] - next[0] * current[1];
	}
	return area / 2;
}

function boundaryBounds(boundary: ReadonlyArray<Point2>) {
	let minX = Infinity;
	let maxX = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	for (const [x, z] of boundary) {
		minX = Math.min(minX, x);
		maxX = Math.max(maxX, x);
		minZ = Math.min(minZ, z);
		maxZ = Math.max(maxZ, z);
	}
	return { minX, maxX, minZ, maxZ };
}
