"use client";

import {
	type AnyNode,
	type AnyNodeId,
	type SiteNode,
	useScene,
} from "@pascal-app/core";
import { SegmentedControl, SliderControl, useEditor } from "@pascal-app/editor";
import { useViewer } from "@pascal-app/viewer";
import {
	ArrowDownToLine,
	ArrowUpFromLine,
	Blend,
	Brush,
	Circle,
	Eraser,
	PaintBucket,
	RotateCcw,
	Square,
	Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import EnvironmentSelector, {
	type EnvironmentTool,
} from "./environment-selector";
import FrontageSelector from "./surroundings/frontage-selector";
import { createGrassHeightField } from "./ground-cover/height-field";
import { updateGrassHeightTexture } from "./ground-cover/height-texture";
import {
	CLEARED_GRASS_PAINT_COLOR,
	createGrassPaintField,
	encodeGrassPaintField,
	siteBounds,
} from "./ground-cover/paint-field";
import { updateGrassPaintTexture } from "./ground-cover/paint-texture";
import {
	getMissingGrassFieldDefaults,
	GrassFieldNode,
} from "./ground-cover/schema";
import {
	activateGroundCoverTool,
	activatePascalShortcut,
	activateSurfaceMaterialTool,
	GROUND_COVER_TOOL,
	SURFACE_MATERIAL_TOOL,
	type GroundCoverToolActionTarget,
} from "./pascal-tool-actions";
import {
	type GroundCoverBrushTool,
	useEnvironmentStore,
} from "./store";
import {
  createSurfaceMaterialField,
  encodeSurfaceMaterialField,
} from './surface-material/field'
import { SURFACE_MATERIAL_PRESENTATION } from './surface-material/materials'
import { SurfaceMaterialNode } from './surface-material/schema'
import { updateSurfacePaintTextures } from './surface-material/texture'
import {
	SURFACE_MATERIAL_PAINT_COLOR,
	type SurfaceMaterialId,
} from "./surface-material/material-types";

const DISABLED_ENVIRONMENT_TOOLS = [
	"atmosphere",
	"water",
] as const satisfies readonly EnvironmentTool[];
const GROUND_COVER_INSTRUCTIONS: Record<GroundCoverBrushTool, string> = {
	"paint-density": "Drag on the ground to paint grass. Press Esc to stop.",
	"erase-density": "Drag on the ground to erase grass. Press Esc to stop.",
	"smooth-density": "Drag on the ground to smooth density. Press Esc to stop.",
	"raise-height": "Drag to raise grass locally. Press Esc to stop.",
	"lower-height": "Drag to lower grass locally. Press Esc to stop.",
	"smooth-height": "Drag to smooth local grass height. Press Esc to stop.",
};


export default function EnvironmentPanel() {
	const activeTool = useEditor((state) => state.tool) as string | null;
	const activeSection = useEnvironmentStore((state) => state.activeSection);
	const setActiveSection = useEnvironmentStore((state) => state.setActiveSection);
	const groundCoverTool = useEnvironmentStore((state) => state.groundCoverTool);
	const nodes = useScene((state) => state.nodes);
	const selectedIds = useViewer((state) => state.selection.selectedIds);
	const layerCount = useScene(
		(state) => Object.values(state.nodes).filter((node) => (node.type as string) === GROUND_COVER_TOOL).length,
	);
	const groundCoverActive = activeTool === GROUND_COVER_TOOL;
	const groundCoverSelected = selectedIds.some(
		(id) => (nodes[id as AnyNodeId]?.type as string | undefined) === GROUND_COVER_TOOL,
	);
	const surfaceActive = activeTool === SURFACE_MATERIAL_TOOL;
	const activateGroundCover = () => {
		const field = getOrCreateGroundCover();
		if (!field) return;
		useViewer.getState().setSelection({ selectedIds: [field.id as AnyNodeId] });
		activateGroundCoverTool(useEditor.getState() as unknown as GroundCoverToolActionTarget);
	};
	const activateSurface = () => {
		const surface = getOrCreateSurfaceMaterial();
		if (!surface) return;
		useViewer.getState().setSelection({ selectedIds: [surface.id as AnyNodeId] });
		activateSurfaceMaterialTool(useEditor.getState() as unknown as GroundCoverToolActionTarget);
	};
	const selectEnvironmentTool = (tool: EnvironmentTool) => {
		if (tool === "ground-cover") {
			setActiveSection(tool);
			activateGroundCover();
		} else if (tool === "path") {
			setActiveSection(tool);
			activateSurface();
		} else if (tool === "surroundings") {
			setActiveSection(tool);
			const editor = useEditor.getState();
			editor.setTool(null);
			editor.setMode("select");
		} else {
			activatePascalShortcut(tool);
		}
	};
	if (activeSection === "ground-cover") {
		return <div className="flex flex-col gap-4 p-4 text-sidebar-foreground">
			<BackButton onClick={() => setActiveSection(undefined)} />
			<header className="flex flex-col gap-2"><h2 className="font-semibold text-base">Ground Cover</h2><p className="text-sidebar-foreground/50 text-xs">{groundCoverActive ? GROUND_COVER_INSTRUCTIONS[groundCoverTool] : "Painting is paused. Resume Ground Cover to continue."}</p></header>
			{(!groundCoverActive || !groundCoverSelected) && <ResumeButton label={groundCoverActive ? "Select layer" : "Resume painting"} onClick={activateGroundCover} />}
			<GroundCoverPaintControls />
		</div>;
	}
	if (activeSection === "path") {
		return <div className="flex flex-col gap-4 p-4 text-sidebar-foreground">
			<BackButton onClick={() => setActiveSection(undefined)} />
			<header className="flex flex-col gap-2"><h2 className="font-semibold text-base">Surface</h2><p className="text-sidebar-foreground/50 text-xs">{surfaceActive ? "Choose a material, then paint directly on the terrain." : "Painting is paused. Resume Surface painting to continue."}</p></header>
			{!surfaceActive && <ResumeButton label="Resume painting" onClick={activateSurface} />}
			<SurfacePaintControls />
		</div>;
	}
	if (activeSection === "surroundings") {
		return <div className="flex flex-col gap-4 p-4 text-sidebar-foreground">
			<BackButton onClick={() => setActiveSection(undefined)} />
			<header className="flex flex-col gap-2"><h2 className="font-semibold text-base">Surroundings</h2><p className="text-sidebar-foreground/50 text-xs">Choose what lies directly beyond each property edge.</p></header>
			<SurroundingsControls />
		</div>;
	}
	return <div className="flex h-full min-h-0 flex-col text-sidebar-foreground">
		<header className="flex flex-col gap-2 px-4 pt-4 pb-3"><h2 className="font-semibold text-base">Environment</h2><p className="text-sidebar-foreground/50 text-xs">Choose an area of the environment to work on.</p></header>
		{layerCount > 0 && <div className="px-4 pb-3"><ResumeButton label={groundCoverSelected ? "Ground Cover · Selected" : "Ground Cover · Select layer"} onClick={() => selectEnvironmentTool("ground-cover")} /></div>}
		<EnvironmentSelector className="flex min-h-0 w-full flex-1 flex-col justify-center" disabledTools={DISABLED_ENVIRONMENT_TOOLS} onSelect={selectEnvironmentTool} />
	</div>;
}

function BackButton({ onClick }: { onClick: () => void }) {
	return <button className="self-start text-sidebar-foreground/60 text-xs transition-colors hover:text-sidebar-foreground" onClick={onClick} type="button">← Environment</button>;
}

function ResumeButton({ label, onClick }: { label: string; onClick: () => void }) {
	return <button className="rounded-md border border-sidebar-border px-3 py-2 text-left text-xs transition-colors hover:bg-sidebar-accent" onClick={onClick} type="button">{label}</button>;
}

function GroundCoverPaintControls() {
	const brush = useEnvironmentStore((state) => state.groundCoverBrush);
	const tool = useEnvironmentStore((state) => state.groundCoverTool);
	const heightAmount = useEnvironmentStore(
		(state) => state.groundCoverHeightAmount,
	);
	const setBrush = useEnvironmentStore((state) => state.setGroundCoverBrush);
	const setTool = useEnvironmentStore((state) => state.setGroundCoverTool);
	const setHeightAmount = useEnvironmentStore(
		(state) => state.setGroundCoverHeightAmount,
	);
	const isHeightTool = tool.endsWith("-height");

	const resolveGroundCover = () => {
		const field = getOrCreateGroundCover();
		if (!field?.parentId) return null;
		const scene = useScene.getState();
		const parent = scene.nodes[field.parentId as AnyNodeId];
		if (parent?.type !== "site") return null;
		return { field, scene, site: parent as SiteNode };
	};

	const replaceField = (density: number, color = brush.color) => {
		const target = resolveGroundCover();
		if (!target) return;
		const paintField = createGrassPaintField(
			siteBounds(target.site.polygon.points),
			color,
			density,
		);
		updateGrassPaintTexture(target.field.id as string, paintField);
		target.scene.updateNode(
			target.field.id as AnyNodeId,
			{ paintMap: encodeGrassPaintField(paintField) } as Partial<AnyNode>,
		);
	};

	const resetHeight = () => {
		const target = resolveGroundCover();
		if (!target) return;
		const heightField = createGrassHeightField(
			siteBounds(target.site.polygon.points),
		);
		updateGrassHeightTexture(target.field.id as string, heightField);
		target.scene.updateNode(
			target.field.id as AnyNodeId,
			{ heightMap: encodeGrassPaintField(heightField) } as Partial<AnyNode>,
		);
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
				<span className="text-sidebar-foreground/60 text-xs">Coverage</span>
				<SegmentedControl
					onChange={setTool}
					options={[
						{
							label: (
								<ToolIcon label="Paint grass density">
									<Brush aria-hidden size={15} />
								</ToolIcon>
							),
							value: "paint-density",
						},
						{
							label: (
								<ToolIcon label="Erase grass density">
									<Eraser aria-hidden size={15} />
								</ToolIcon>
							),
							value: "erase-density",
						},
						{
							label: (
								<ToolIcon label="Smooth grass density">
									<Blend aria-hidden size={15} />
								</ToolIcon>
							),
							value: "smooth-density",
						},
					]}
					value={tool}
				/>
				<span className="text-sidebar-foreground/60 text-xs">Height</span>
				<SegmentedControl
					onChange={setTool}
					options={[
						{
							label: (
								<ToolIcon label="Raise grass locally">
									<ArrowUpFromLine aria-hidden size={15} />
								</ToolIcon>
							),
							value: "raise-height",
						},
						{
							label: (
								<ToolIcon label="Lower grass locally">
									<ArrowDownToLine aria-hidden size={15} />
								</ToolIcon>
							),
							value: "lower-height",
						},
						{
							label: (
								<ToolIcon label="Smooth local grass height">
									<Blend aria-hidden size={15} />
								</ToolIcon>
							),
							value: "smooth-height",
						},
					]}
					value={tool}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<SliderControl
					label="Size"
					max={20}
					min={0.25}
					onChange={(radius) => setBrush({ radius })}
					step={0.25}
					unit="m"
					value={brush.radius}
				/>
				<SliderControl
					label="Strength"
					max={100}
					min={1}
					onChange={(strength) => setBrush({ strength: strength / 100 })}
					step={1}
					unit="%"
					value={Math.round(brush.strength * 100)}
				/>
				<SliderControl
					label="Softness"
					max={100}
					min={0}
					onChange={(falloff) => setBrush({ falloff: falloff / 100 })}
					step={1}
					unit="%"
					value={Math.round(brush.falloff * 100)}
				/>
			</div>

			<div className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
				<span className="text-sidebar-foreground/60 text-xs">Shape</span>
				<SegmentedControl
					onChange={(shape) => setBrush({ shape })}
					options={[
						{
							label: (
								<ToolIcon label="Round brush">
									<Circle aria-hidden size={14} />
								</ToolIcon>
							),
							value: "round",
						},
						{
							label: (
								<ToolIcon label="Square brush">
									<Square aria-hidden size={14} />
								</ToolIcon>
							),
							value: "square",
						},
					]}
					value={brush.shape}
				/>
			</div>

			{isHeightTool ? (
				tool !== "smooth-height" && (
					<SliderControl
						label="Height change"
						max={100}
						min={5}
						onChange={setHeightAmount}
						step={5}
						unit="%"
						value={heightAmount}
					/>
				)
			) : (
				<>
					<div className="flex items-center justify-between gap-3">
						<label
							className="text-sidebar-foreground/60 text-xs"
							htmlFor="ground-cover-paint-color"
						>
							Color
						</label>
						<input
							className="h-8 w-12 cursor-pointer rounded border border-sidebar-border bg-transparent p-1"
							id="ground-cover-paint-color"
							onChange={(event) => setBrush({ color: event.target.value })}
							type="color"
							value={brush.color}
						/>
					</div>
					{tool === "paint-density" && (
						<SliderControl
							label="Target density"
							max={100}
							min={0}
							onChange={(targetDensity) =>
								setBrush({ targetDensity: targetDensity / 100 })
							}
							step={1}
							unit="%"
							value={Math.round(brush.targetDensity * 100)}
						/>
					)}
					<SliderControl
						label="Noise"
						max={100}
						min={0}
						onChange={(noiseAmount) =>
							setBrush({ noiseAmount: noiseAmount / 100 })
						}
						step={1}
						unit="%"
						value={Math.round(brush.noiseAmount * 100)}
					/>
				</>
			)}

			<div className="flex justify-end gap-1.5 border-sidebar-border border-t pt-3">
				{isHeightTool ? (
					<IconActionButton label="Reset local grass height" onClick={resetHeight}>
						<RotateCcw aria-hidden size={15} />
					</IconActionButton>
				) : (
					<>
						<IconActionButton
							label="Clear all grass"
							onClick={() => replaceField(0, CLEARED_GRASS_PAINT_COLOR)}
						>
							<Trash2 aria-hidden size={15} />
						</IconActionButton>
						<IconActionButton
							label="Fill site with grass"
							onClick={() => replaceField(1)}
						>
							<PaintBucket aria-hidden size={15} />
						</IconActionButton>
					</>
				)}
			</div>
		</div>
	);
}

function ToolIcon({ children, label }: { children: ReactNode; label: string }) {
	return (
		<span className="flex items-center justify-center" title={label}>
			{children}
			<span className="sr-only">{label}</span>
		</span>
	);
}

function IconActionButton({
	children,
	label,
	onClick,
}: {
	children: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			aria-label={label}
			className="flex size-8 items-center justify-center rounded-md border border-sidebar-border text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
			onClick={onClick}
			title={label}
			type="button"
		>
			{children}
		</button>
	);
}

function SurroundingsControls() {
	const site = useScene((state) => {
		const siteId = state.rootNodeIds.find(
			(id) => (state.nodes[id]?.type as string | undefined) === "site",
		);
		return siteId ? (state.nodes[siteId] as SiteNode) : undefined;
	});
	const cameraAzimuth = useEditor(
		(state) => state.navigationSyncPose?.azimuth ?? 0,
	);
	const contexts = useEnvironmentStore((state) => state.frontageContexts);
	const enabled = useEnvironmentStore((state) => state.surroundingsEnabled);
	const setFrontageSeparator = useEnvironmentStore((state) => state.setFrontageSeparator);
	const setEnabled = useEnvironmentStore((state) => state.setSurroundingsEnabled);

	if (!site) {
		return <p className="text-destructive text-xs" role="alert">A root Site is required to configure surroundings.</p>;
	}

	return (
		<div className="flex flex-col gap-3">
			<label className="flex items-center justify-between gap-3 rounded-md border border-sidebar-border px-3 py-2 text-xs">
				<span>Show neighborhood</span>
				<input
					aria-label="Show neighborhood"
					checked={enabled}
					onChange={(event) => setEnabled(event.target.checked)}
					type="checkbox"
				/>
			</label>
			<FrontageSelector
				cameraAzimuth={cameraAzimuth}
				contexts={contexts}
				onSeparatorChange={setFrontageSeparator}
				points={site.polygon.points}
			/>
			<p className="text-sidebar-foreground/50 text-xs">Runtime only — visibility and frontage settings remain in memory and are not saved yet.</p>
		</div>
	);
}

function SurfacePaintControls() {
	const brush = useEnvironmentStore((state) => state.surfaceBrush);
	const material = useEnvironmentStore((state) => state.surfaceMaterial);
	const setBrush = useEnvironmentStore((state) => state.setSurfaceBrush);
	const setMaterial = useEnvironmentStore((state) => state.setSurfaceMaterial);
	const textureSize = useScene((state) => {
		const surface = Object.values(state.nodes).find(
			(node) => (node.type as string) === SURFACE_MATERIAL_TOOL,
		) as unknown as SurfaceMaterialNode | undefined;
		return surface?.textureSize ?? 100;
	});
	const setTextureSize = (value: number) => {
		const surface = getOrCreateSurfaceMaterial();
		if (!surface) return;
		useScene.getState().updateNode(
			surface.id as AnyNodeId,
			{ textureSize: value } as Partial<AnyNode>,
		);
	};
	const replaceSurface = (fillMaterial?: SurfaceMaterialId) => {
		const surface = getOrCreateSurfaceMaterial();
		if (!surface?.parentId) return;
		const site = useScene.getState().nodes[surface.parentId as AnyNodeId];
		if (site?.type !== "site") return;
		const field = createSurfaceMaterialField(siteBounds(site.polygon.points));
		const color = fillMaterial ? SURFACE_MATERIAL_PAINT_COLOR[fillMaterial] : null;
		if (color) {
			for (let index = 0; index < field.values.length; index += 4) {
				field.values[index] = color.r;
				field.values[index + 1] = color.g;
				field.values[index + 2] = color.b;
				field.values[index + 3] = 255;
			}
		}
		updateSurfacePaintTextures(surface.id, field);
		useScene.getState().updateNode(
			surface.id as AnyNodeId,
			{ paintMap: encodeSurfaceMaterialField(field) } as Partial<AnyNode>,
		);
	};
	return (
		<div className="flex flex-col gap-3">
			<div className="grid grid-cols-2 gap-2">
				{SURFACE_MATERIAL_PRESENTATION.map((presentation) => (
					<button
						aria-pressed={material === presentation.id}
						className={`overflow-hidden rounded-md border text-left text-xs ${material === presentation.id ? "border-sidebar-foreground" : "border-sidebar-border"}`}
						key={presentation.id}
						onClick={() => setMaterial(presentation.id)}
						type="button"
					>
						<img alt="" className="aspect-square w-full object-cover" src={presentation.preview} />
						<span className="block p-1.5">{presentation.label}</span>
					</button>
				))}
			</div>
			<SegmentedControl
				onChange={(mode) => setBrush({ mode })}
				options={[
					{
						label: (
							<ToolIcon label="Paint surface material">
								<Brush aria-hidden size={15} />
							</ToolIcon>
						),
						value: "paint",
					},
					{
						label: (
							<ToolIcon label="Smooth surface material">
								<Blend aria-hidden size={15} />
							</ToolIcon>
						),
						value: "smooth",
					},
				]}
				value={brush.mode === "erase" ? "paint" : brush.mode}
			/>
			<div className="flex flex-col gap-1.5">
				<SliderControl label="Size" max={20} min={0.25} onChange={(radius) => setBrush({ radius })} precision={2} step={0.25} unit="m" value={brush.radius} />
				<SliderControl label="Strength" max={1} min={0.05} onChange={(strength) => setBrush({ strength })} precision={2} step={0.05} value={brush.strength} />
				<SliderControl label="Softness" max={1} min={0} onChange={(falloff) => setBrush({ falloff })} precision={2} step={0.05} value={brush.falloff} />
				<SliderControl label="Texture size" max={200} min={25} onChange={setTextureSize} precision={0} step={5} unit="%" value={textureSize} />
			</div>
			<div className="flex justify-end gap-1.5 border-sidebar-border/60 border-t pt-3">
				<IconActionButton
					label="Clear surface materials"
					onClick={() => replaceSurface()}
				>
					<Trash2 aria-hidden size={15} />
				</IconActionButton>
				<IconActionButton
					label={`Fill site with ${SURFACE_MATERIAL_PRESENTATION.find((item) => item.id === material)?.label ?? "selected material"}`}
					onClick={() => replaceSurface(material)}
				>
					<PaintBucket aria-hidden size={15} />
				</IconActionButton>
			</div>
		</div>
	);
}

function getOrCreateGroundCover(): AnyNode | null {
	const scene = useScene.getState();
	let field = Object.values(scene.nodes).find(
		(node) => (node.type as string) === GROUND_COVER_TOOL,
	);

	if (!field) {
		const siteId = scene.rootNodeIds.find(
			(id) => (scene.nodes[id]?.type as string | undefined) === "site",
		);
		if (!siteId) return null;
		const site = scene.nodes[siteId] as SiteNode;
		const paint = createGrassPaintField(
			siteBounds(site.polygon.points),
			CLEARED_GRASS_PAINT_COLOR,
			0,
		);
		const height = createGrassHeightField(siteBounds(site.polygon.points));
		field = GrassFieldNode.parse({
			parentId: siteId,
			paintMap: encodeGrassPaintField(paint),
			heightMap: encodeGrassPaintField(height),
		}) as unknown as AnyNode;
		scene.createNode(field, siteId as AnyNodeId);
	}

	const patch = getMissingGrassFieldDefaults(field);
	if (Object.keys(patch).length > 0) {
		scene.updateNode(field.id as AnyNodeId, patch as Partial<AnyNode>);
		field = { ...field, ...patch } as AnyNode;
	}

	return field;
}

function getOrCreateSurfaceMaterial(): AnyNode | null {
	const scene = useScene.getState();
	let surface = Object.values(scene.nodes).find(
		(node) => (node.type as string) === SURFACE_MATERIAL_TOOL,
	);
	if (surface) return surface;
	const siteId = scene.rootNodeIds.find(
		(id) => (scene.nodes[id]?.type as string | undefined) === "site",
	);
	if (!siteId) return null;
	const site = scene.nodes[siteId] as SiteNode;
	const field = createSurfaceMaterialField(siteBounds(site.polygon.points));
	surface = SurfaceMaterialNode.parse({
		parentId: siteId,
		paintMap: encodeSurfaceMaterialField(field),
	}) as unknown as AnyNode;
	scene.createNode(surface, siteId as AnyNodeId);
	updateSurfacePaintTextures(surface.id as string, field);
	return surface;
}
