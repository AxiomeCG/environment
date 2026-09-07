"use client";

import {
	type AnyNode,
	type AnyNodeId,
	type SiteNode,
	sceneRegistry,
	useLiveTerrain,
	useScene,
} from "@pascal-app/core";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import {
	updateGrassFieldObstacles,
	updateGrassFieldTerrain,
	updateGrassFieldUniforms,
} from "./geometry";
import { changedGrassObstacleSiteIds } from "./obstacle-adapter";
import { updateGrassTileLod } from "./render/grass-tiles";
import type { GrassFieldNode } from "./schema";

const GRASS_FIELD_KIND = "environment:ground-cover";

function grassPaintMapsEqual(
	previous: GrassFieldNode["paintMap"],
	current: GrassFieldNode["paintMap"],
): boolean {
	if (previous === current) return true;
	if (!previous || !current) return false;
	return (
		previous.origin[0] === current.origin[0] &&
		previous.origin[1] === current.origin[1] &&
		previous.spacing === current.spacing &&
		previous.cols === current.cols &&
		previous.rows === current.rows &&
		previous.values === current.values
	);
}

export function grassFieldGeometryInputsEqual(
	previous: GrassFieldNode,
	current: GrassFieldNode,
): boolean {
	return (
		previous.id === current.id &&
		previous.parentId === current.parentId &&
		previous.bladeWidth === current.bladeWidth &&
		previous.bladeWidthVariation === current.bladeWidthVariation &&
		previous.bladeHeight === current.bladeHeight &&
		previous.bladeHeightVariation === current.bladeHeightVariation &&
		grassPaintMapsEqual(previous.paintMap, current.paintMap)
	);
}
export type GrassFieldSiteChange = {
	id: string;
	boundaryChanged: boolean;
	terrainChanged: boolean;
};

export function grassFieldSiteChanges(
	currentNodes: Record<string, AnyNode>,
	previousNodes: Record<string, AnyNode>,
): GrassFieldSiteChange[] {
	const changes: GrassFieldSiteChange[] = [];

	for (const node of Object.values(currentNodes)) {
		if ((node.type as string) !== GRASS_FIELD_KIND) continue;

		const previousNode = previousNodes[node.id];
		if (!previousNode) continue;

		const currentParentId = node.parentId as AnyNodeId | null;
		const previousParentId = previousNode.parentId as AnyNodeId | null;
		const currentSite = currentParentId
			? currentNodes[currentParentId]
			: undefined;
		const previousSite = previousParentId
			? previousNodes[previousParentId]
			: undefined;
		if (
			currentParentId !== previousParentId ||
			currentSite?.type !== "site" ||
			previousSite?.type !== "site"
		) {
			changes.push({
				id: node.id,
				boundaryChanged: true,
				terrainChanged: false,
			});
			continue;
		}

		const boundaryChanged = currentSite.polygon !== previousSite.polygon;
		const terrainChanged = currentSite.terrain !== previousSite.terrain;
		if (boundaryChanged || terrainChanged) {
			changes.push({ id: node.id, boundaryChanged, terrainChanged });
		}
	}

	return changes;
}

export default function GrassFieldSystem() {
	const previousNodesRef = useRef(new Map<string, GrassFieldNode>());

	useEffect(() => {
		const unsubscribeScene = useScene.subscribe((current, previous) => {
			const changes = grassFieldSiteChanges(current.nodes, previous.nodes);
			for (const change of changes) {
				const node = current.nodes[change.id as AnyNodeId];
				const site = node?.parentId
					? current.nodes[node.parentId as AnyNodeId]
					: undefined;
				const group = sceneRegistry.nodes.get(change.id);
				if (
					!change.boundaryChanged &&
					change.terrainChanged &&
					site?.type === "site" &&
					group &&
					updateGrassFieldTerrain(group, site)
				) {
					continue;
				}
				current.markDirty(change.id as AnyNodeId);
			}
			const obstacleSiteIds = changedGrassObstacleSiteIds(
				current.nodes,
				previous.nodes,
			);
			if (obstacleSiteIds.size > 0) {
				for (const candidate of Object.values(current.nodes)) {
					if (
						(candidate.type as string) !== GRASS_FIELD_KIND ||
						!obstacleSiteIds.has(candidate.parentId as string)
					) {
						continue;
					}
					const field = candidate as unknown as GrassFieldNode;
					const site = field.parentId
						? current.nodes[field.parentId as AnyNodeId]
						: undefined;
					if (
						site?.type !== "site" ||
						!updateGrassFieldObstacles(field, site, current.nodes)
					) {
						current.markDirty(field.id as AnyNodeId);
					}
				}
			}
		});

		const unsubscribeLiveTerrain = useLiveTerrain.subscribe(
			(current, previous) => {
				const siteIds = new Set([
					...current.strokes.keys(),
					...current.remoteStrokes.keys(),
					...previous.strokes.keys(),
					...previous.remoteStrokes.keys(),
				]);
				const changedSiteIds = new Set<string>();

				for (const siteId of siteIds) {
					const currentField =
						current.strokes.get(siteId)?.field ??
						current.remoteStrokes.get(siteId)?.field;
					const previousField =
						previous.strokes.get(siteId)?.field ??
						previous.remoteStrokes.get(siteId)?.field;
					if (currentField !== previousField) changedSiteIds.add(siteId);
				}

				if (changedSiteIds.size > 0) {
					const scene = useScene.getState();
					for (const node of Object.values(scene.nodes)) {
						if (
							(node.type as string) !== GRASS_FIELD_KIND ||
							!changedSiteIds.has(node.parentId as string)
						) {
							continue;
						}

						const site = scene.nodes[node.parentId as AnyNodeId];
						const group = sceneRegistry.nodes.get(node.id);
						if (
							site?.type !== "site" ||
							!group ||
							!updateGrassFieldTerrain(group, site as SiteNode)
						) {
							scene.markDirty(node.id);
						}
					}
				}
			},
		);

		const previousNodes = previousNodesRef.current;
		return () => {
			unsubscribeScene();
			unsubscribeLiveTerrain();
			previousNodes.clear();
		};
	}, []);

	useFrame(({ camera, size, gl }) => {
		const { clearDirty, dirtyNodes, nodes } = useScene.getState();
		const previousNodes = previousNodesRef.current;
		const registeredByType = sceneRegistry.byType as Record<
			string,
			Set<string> | undefined
		>;
		const fieldIds = registeredByType[GRASS_FIELD_KIND];
		if (!fieldIds) return;

		for (const id of fieldIds) {
			const node = nodes[id as AnyNodeId];
			if (!node || (node.type as string) !== GRASS_FIELD_KIND) continue;
			const current = node as unknown as GrassFieldNode;
			const previous = previousNodes.get(id);
			const group = sceneRegistry.nodes.get(id);
			if (group) updateGrassTileLod(group, camera, size.height * gl.getPixelRatio());

			if (!previous) {
				previousNodes.set(id, current);
				continue;
			}
			if (!dirtyNodes.has(id as AnyNodeId) || previous === current) continue;

			previousNodes.set(id, current);
			if (!group || !updateGrassFieldUniforms(group, current)) continue;
			if (grassFieldGeometryInputsEqual(previous, current))
				clearDirty(id as AnyNodeId);
		}

		for (const id of previousNodes.keys()) {
			if (!nodes[id as AnyNodeId]) previousNodes.delete(id);
		}
	}, 1);

	return null;
}
