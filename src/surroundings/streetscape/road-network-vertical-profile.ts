import { CatmullRomCurve3, Vector3 } from "three";
import type {
	RoadGraphEdge,
	RoadNetworkNode,
	RoadVerticalProfilePoint,
} from "./schema";

export type ProfileSummary = {
	length: number;
	maxAbsGrade: number;
	segments: Array<{ from: number; grade: number; to: number }>;
};

type StationPoint = { elevation: number; station: number };

function planSamples(
	start: readonly [number, number, number],
	alignment: ReadonlyArray<readonly [number, number, number]>,
	end: readonly [number, number, number],
	segments = 160,
): Array<[number, number, number]> {
	const authored = [start, ...alignment, end].map(
		(point) => new Vector3(point[0], 0, point[2]),
	);
	if (authored.length <= 2) {
		return Array.from({ length: Math.max(2, segments + 1) }, (_, index) => {
			const t = index / Math.max(1, segments);
			return [
				start[0] + (end[0] - start[0]) * t,
				0,
				start[2] + (end[2] - start[2]) * t,
			];
		});
	}
	const curve = new CatmullRomCurve3(authored, false, "centripetal");
	return curve
		.getPoints(Math.max(segments, (authored.length - 1) * 32))
		.map((point) => [point.x, 0, point.z]);
}

function cumulativeStations(
	points: ReadonlyArray<readonly [number, number, number]>,
): number[] {
	const stations = [0];
	for (let index = 1; index < points.length; index++) {
		const previous = points[index - 1];
		const point = points[index];
		if (!previous || !point) continue;
		stations.push(
			(stations.at(-1) ?? 0) +
				Math.hypot(point[0] - previous[0], point[2] - previous[2]),
		);
	}
	return stations;
}

export function roadPlanLength(
	network: Pick<RoadNetworkNode, "graphNodes">,
	edge: RoadGraphEdge,
): number {
	const start = network.graphNodes[edge.startNodeId];
	const end = network.graphNodes[edge.endNodeId];
	if (!start || !end) return 0;
	return (
		cumulativeStations(
			planSamples(start.position, edge.alignment, end.position),
		).at(-1) ?? 0
	);
}

export function roadPlanPointAtStation(
	network: Pick<RoadNetworkNode, "graphNodes">,
	edge: RoadGraphEdge,
	station: number,
): [number, number, number] | null {
	const start = network.graphNodes[edge.startNodeId];
	const end = network.graphNodes[edge.endNodeId];
	if (!start || !end) return null;
	const points = planSamples(start.position, edge.alignment, end.position);
	const stations = cumulativeStations(points);
	const total = stations.at(-1) ?? 0;
	const target = Math.max(0, Math.min(total, station));
	for (let index = 1; index < stations.length; index++) {
		const toStation = stations[index] ?? total;
		if (toStation < target) continue;
		const fromStation = stations[index - 1] ?? 0;
		const from = points[index - 1];
		const to = points[index];
		if (!from || !to) return null;
		const span = Math.max(1e-9, toStation - fromStation);
		const mix = (target - fromStation) / span;
		return [
			from[0] + (to[0] - from[0]) * mix,
			0,
			from[2] + (to[2] - from[2]) * mix,
		];
	}
	return points.at(-1) ?? null;
}

function profileStations(
	profile: ReadonlyArray<RoadVerticalProfilePoint>,
	length: number,
	startElevation: number,
	endElevation: number,
): StationPoint[] {
	const interiors = [...profile]
		.map((point) => ({
			elevation: point.elevation,
			station: Math.max(0, Math.min(length, point.station)),
		}))
		.filter((point) => point.station > 1e-6 && point.station < length - 1e-6)
		.sort((left, right) => left.station - right.station);
	return [
		{ elevation: startElevation, station: 0 },
		...interiors,
		{ elevation: endElevation, station: length },
	];
}

function linearElevation(points: StationPoint[], station: number): number {
	for (let index = 1; index < points.length; index++) {
		const from = points[index - 1];
		const to = points[index];
		if (!from || !to || station > to.station) continue;
		const span = Math.max(1e-9, to.station - from.station);
		return (
			from.elevation +
			(to.elevation - from.elevation) * ((station - from.station) / span)
		);
	}
	return points.at(-1)?.elevation ?? 0;
}

/** Evaluate grades with optional symmetric parabolic curves around each PVI. */
export function roadProfileElevationAtStation(
	profile: ReadonlyArray<RoadVerticalProfilePoint>,
	length: number,
	startElevation: number,
	endElevation: number,
	station: number,
): number {
	const target = Math.max(0, Math.min(length, station));
	const points = profileStations(profile, length, startElevation, endElevation);
	const sortedProfile = [...profile].sort(
		(left, right) => left.station - right.station,
	);
	for (const pvi of sortedProfile) {
		const index = points.findIndex(
			(point) =>
				Math.abs(point.station - Math.max(0, Math.min(length, pvi.station))) <
				1e-6,
		);
		if (index <= 0 || index >= points.length - 1) continue;
		const previous = points[index - 1];
		const current = points[index];
		const next = points[index + 1];
		if (!previous || !current || !next) continue;
		const curveLength = Math.min(
			Math.max(0, pvi.curveLength),
			2 * (current.station - previous.station),
			2 * (next.station - current.station),
		);
		if (curveLength <= 1e-6) continue;
		const begin = current.station - curveLength / 2;
		const end = current.station + curveLength / 2;
		if (target < begin || target > end) continue;
		const incomingGrade =
			(current.elevation - previous.elevation) /
			Math.max(1e-9, current.station - previous.station);
		const outgoingGrade =
			(next.elevation - current.elevation) /
			Math.max(1e-9, next.station - current.station);
		const distance = target - begin;
		const beginElevation =
			current.elevation - incomingGrade * (curveLength / 2);
		return (
			beginElevation +
			incomingGrade * distance +
			((outgoingGrade - incomingGrade) / (2 * curveLength)) * distance ** 2
		);
	}
	return linearElevation(points, target);
}

export function applyRoadVerticalProfile(
	planPoints: ReadonlyArray<readonly [number, number, number]>,
	profile: ReadonlyArray<RoadVerticalProfilePoint>,
	startElevation: number,
	endElevation: number,
): Array<[number, number, number]> {
	const stations = cumulativeStations(planPoints);
	const length = stations.at(-1) ?? 0;
	return planPoints.map((point, index) => [
		point[0],
		roadProfileElevationAtStation(
			profile,
			length,
			startElevation,
			endElevation,
			stations[index] ?? 0,
		),
		point[2],
	]);
}

function closestSampleStation(
	point: readonly [number, number, number],
	points: Array<[number, number, number]>,
	stations: number[],
): number {
	let bestIndex = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let index = 0; index < points.length; index++) {
		const sample = points[index];
		if (!sample) continue;
		const distance = Math.hypot(sample[0] - point[0], sample[2] - point[2]);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index;
		}
	}
	return stations[bestIndex] ?? 0;
}

export function enableRoadVerticalProfile(
	network: RoadNetworkNode,
	edgeId: string,
): Pick<RoadNetworkNode, "edges"> | null {
	const edge = network.edges[edgeId];
	const start = edge ? network.graphNodes[edge.startNodeId] : undefined;
	const end = edge ? network.graphNodes[edge.endNodeId] : undefined;
	if (!edge || !start || !end) return null;
	if (edge.profileMode === "designed") return { edges: network.edges };
	const samples = planSamples(start.position, edge.alignment, end.position);
	const stations = cumulativeStations(samples);
	const verticalProfile = edge.alignment.map((point, index) => ({
		id: `profile-${edge.id}-${index + 1}`,
		station: closestSampleStation(point, samples, stations),
		elevation: point[1],
		curveLength: 0,
		alignmentPointIndex: index,
	}));
	return {
		edges: {
			...network.edges,
			[edgeId]: { ...edge, profileMode: "designed", verticalProfile },
		},
	};
}

export function updateRoadVerticalProfilePoint(
	network: RoadNetworkNode,
	edgeId: string,
	pointId: string,
	patch: Partial<
		Pick<RoadVerticalProfilePoint, "curveLength" | "elevation" | "station">
	>,
): Pick<RoadNetworkNode, "edges"> | null {
	const edge = network.edges[edgeId];
	if (!edge || edge.profileMode !== "designed") return null;
	const length = roadPlanLength(network, edge);
	let found = false;
	let linkedAlignmentIndex: number | undefined;
	let linkedElevation: number | undefined;
	const verticalProfile = edge.verticalProfile
		.map((point) => {
			if (point.id !== pointId) return point;
			found = true;
			linkedAlignmentIndex = point.alignmentPointIndex;
			linkedElevation = patch.elevation;
			return {
				...point,
				...(patch.station === undefined
					? {}
					: { station: Math.max(0, Math.min(length, patch.station)) }),
				...(patch.elevation === undefined
					? {}
					: { elevation: patch.elevation }),
				...(patch.curveLength === undefined
					? {}
					: { curveLength: Math.max(0, patch.curveLength) }),
			};
		})
		.sort((left, right) => left.station - right.station);
	if (!found) return null;
	const alignment = edge.alignment.map((point, index) =>
		index === linkedAlignmentIndex && linkedElevation !== undefined
			? ([point[0], linkedElevation, point[2]] as [number, number, number])
			: point,
	);
	return {
		edges: {
			...network.edges,
			[edgeId]: { ...edge, alignment, verticalProfile },
		},
	};
}

export function addRoadVerticalProfilePoint(
	network: RoadNetworkNode,
	edgeId: string,
): Pick<RoadNetworkNode, "edges"> | null {
	const edge = network.edges[edgeId];
	const start = edge ? network.graphNodes[edge.startNodeId] : undefined;
	const end = edge ? network.graphNodes[edge.endNodeId] : undefined;
	if (!edge || !start || !end || edge.profileMode !== "designed") return null;
	const length = roadPlanLength(network, edge);
	const occupied = [
		0,
		...edge.verticalProfile.map((point) => point.station),
		length,
	].sort((left, right) => left - right);
	let from = 0;
	let to = length;
	for (let index = 1; index < occupied.length; index++) {
		const candidateFrom = occupied[index - 1] ?? 0;
		const candidateTo = occupied[index] ?? length;
		if (candidateTo - candidateFrom > to - from) {
			from = candidateFrom;
			to = candidateTo;
		}
	}
	const station = (from + to) / 2;
	const existingIds = new Set(edge.verticalProfile.map((point) => point.id));
	let suffix = edge.verticalProfile.length + 1;
	let id = `profile-${edge.id}-${suffix}`;
	while (existingIds.has(id)) id = `profile-${edge.id}-${++suffix}`;
	const verticalProfile = [
		...edge.verticalProfile,
		{
			id,
			station,
			elevation: roadProfileElevationAtStation(
				edge.verticalProfile,
				length,
				start.position[1],
				end.position[1],
				station,
			),
			curveLength: 0,
		},
	].sort((left, right) => left.station - right.station);
	return {
		edges: { ...network.edges, [edgeId]: { ...edge, verticalProfile } },
	};
}

export function deleteRoadVerticalProfilePoint(
	network: RoadNetworkNode,
	edgeId: string,
	pointId: string,
): Pick<RoadNetworkNode, "edges"> | null {
	const edge = network.edges[edgeId];
	if (!edge || !edge.verticalProfile.some((point) => point.id === pointId))
		return null;
	return {
		edges: {
			...network.edges,
			[edgeId]: {
				...edge,
				verticalProfile: edge.verticalProfile.filter(
					(point) => point.id !== pointId,
				),
			},
		},
	};
}

export function smoothRoadVerticalProfile(
	network: RoadNetworkNode,
	edgeId: string,
): Pick<RoadNetworkNode, "edges"> | null {
	const edge = network.edges[edgeId];
	if (!edge || edge.profileMode !== "designed") return null;
	const length = roadPlanLength(network, edge);
	const sorted = [...edge.verticalProfile].sort(
		(left, right) => left.station - right.station,
	);
	const verticalProfile = sorted.map((point, index) => {
		const previousStation = sorted[index - 1]?.station ?? 0;
		const nextStation = sorted[index + 1]?.station ?? length;
		return {
			...point,
			curveLength: Math.max(
				0,
				Math.min(
					30,
					(point.station - previousStation) * 0.8,
					(nextStation - point.station) * 0.8,
				),
			),
		};
	});
	return {
		edges: { ...network.edges, [edgeId]: { ...edge, verticalProfile } },
	};
}

export function bakeRoadVerticalProfile(
	network: RoadNetworkNode,
	edgeId: string,
): Pick<RoadNetworkNode, "edges"> | null {
	const edge = network.edges[edgeId];
	const start = edge ? network.graphNodes[edge.startNodeId] : undefined;
	const end = edge ? network.graphNodes[edge.endNodeId] : undefined;
	if (!edge || !start || !end || edge.profileMode !== "designed") return null;
	const length = roadPlanLength(network, edge);
	const linked = new Map(
		edge.verticalProfile.flatMap((point) =>
			point.alignmentPointIndex === undefined
				? []
				: [[point.alignmentPointIndex, point] as const],
		),
	);
	const samples = planSamples(start.position, edge.alignment, end.position);
	const stations = cumulativeStations(samples);
	const alignment = edge.alignment.map((point, index) => {
		const station =
			linked.get(index)?.station ??
			closestSampleStation(point, samples, stations);
		return [
			point[0],
			roadProfileElevationAtStation(
				edge.verticalProfile,
				length,
				start.position[1],
				end.position[1],
				station,
			),
			point[2],
		] as [number, number, number];
	});
	return {
		edges: {
			...network.edges,
			[edgeId]: {
				...edge,
				alignment,
				profileMode: "legacy",
				verticalProfile: [],
			},
		},
	};
}

export function roadVerticalProfileSummary(
	network: Pick<RoadNetworkNode, "graphNodes">,
	edge: RoadGraphEdge,
): ProfileSummary {
	const start = network.graphNodes[edge.startNodeId];
	const end = network.graphNodes[edge.endNodeId];
	const length = roadPlanLength(network, edge);
	if (!start || !end || length <= 1e-9) {
		return { length, maxAbsGrade: 0, segments: [] };
	}
	const points = profileStations(
		edge.verticalProfile ?? [],
		length,
		start.position[1],
		end.position[1],
	);
	const segments = points.slice(1).flatMap((to, index) => {
		const from = points[index];
		if (!from) return [];
		return [
			{
				from: from.station,
				to: to.station,
				grade:
					(to.elevation - from.elevation) /
					Math.max(1e-9, to.station - from.station),
			},
		];
	});
	return {
		length,
		maxAbsGrade: Math.max(
			0,
			...segments.map((segment) => Math.abs(segment.grade)),
		),
		segments,
	};
}

export function splitRoadVerticalProfile(
	profile: ReadonlyArray<RoadVerticalProfilePoint>,
	splitStation: number,
): [RoadVerticalProfilePoint[], RoadVerticalProfilePoint[]] {
	return [
		profile
			.filter((point) => point.station < splitStation - 1e-6)
			.map((point) => ({ ...point, alignmentPointIndex: undefined })),
		profile
			.filter((point) => point.station > splitStation + 1e-6)
			.map((point) => ({
				...point,
				station: point.station - splitStation,
				alignmentPointIndex: undefined,
			})),
	];
}
