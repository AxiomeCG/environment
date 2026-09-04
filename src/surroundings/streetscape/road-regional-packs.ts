import type { RoadNetworkNode } from "./schema";

export type RoadRegionalPackId = RoadNetworkNode["regionalPack"];

export type RoadRegionalPack = {
	centerlineColor: string;
	drivingSide: "left" | "right";
	id: RoadRegionalPackId;
	label: string;
	markingColor: string;
};

/** Regional traffic rules consumed by lane-side and marking generation. */
export const ROAD_REGIONAL_PACKS: Record<RoadRegionalPackId, RoadRegionalPack> = {
	"right-driving": {
		centerlineColor: "#e8c447",
		drivingSide: "right",
		id: "right-driving",
		label: "Right-driving",
		markingColor: "#f3f1df",
	},
	"left-driving": {
		centerlineColor: "#f3f1df",
		drivingSide: "left",
		id: "left-driving",
		label: "Left-driving",
		markingColor: "#f3f1df",
	},
};

export function resolveRoadRegionalPack(
	node: Pick<RoadNetworkNode, "regionalPack">,
): RoadRegionalPack {
	return ROAD_REGIONAL_PACKS[node.regionalPack] ?? ROAD_REGIONAL_PACKS["right-driving"];
}
