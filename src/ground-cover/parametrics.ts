import type { ParametricDescriptor } from "@pascal-app/core"
import type { GrassFieldNode } from "./schema"

export const grassFieldParametrics: ParametricDescriptor<GrassFieldNode> = {
  groups: [
    {
      label: "Grass appearance (global)",
      fields: [
        {
          key: "density",
          kind: "number",
          unit: "%",
          min: 0,
          max: 100,
          step: 1,
        },
        {
          key: "bladeHeight",
          kind: "number",
          unit: "m",
          min: 0.05,
          max: 1,
          step: 0.01,
        },
        {
          key: "bladeWidth",
          kind: "number",
          unit: "m",
          min: 0.005,
          max: 0.2,
          step: 0.005,
        },
        {
          key: "bladeTipBrightness",
          kind: "number",
          unit: "%",
          min: 0,
          max: 500,
          step: 5,
        },
      ],
    },
    {
      label: "Natural variation",
      fields: [
        {
          key: "bladeHeightVariation",
          kind: "number",
          unit: "%",
          min: 0,
          max: 100,
          step: 1,
        },
        {
          key: "bladeWidthVariation",
          kind: "number",
          unit: "%",
          min: 0,
          max: 100,
          step: 1,
        },
        {
          key: "bladeTintVariation",
          kind: "number",
          unit: "%",
          min: 0,
          max: 100,
          step: 1,
        },
      ],
    },
    {
      label: "Wind",
      fields: [
        {
          key: "windStrength",
          kind: "number",
          unit: "%",
          min: 0,
          max: 200,
          step: 5,
        },
        {
          key: "grassWindInfluence",
          kind: "number",
          unit: "%",
          min: 0,
          max: 300,
          step: 5,
        },
      ],
    },
    {
      label: "Obstacle interaction",
      fields: [
        {
          key: "obstacleBendRadius",
          kind: "number",
          unit: "m",
          min: 0,
          max: 3,
          step: 0.05,
        },
        {
          key: "obstacleBendStrength",
          kind: "number",
          unit: "m",
          min: 0,
          max: 0.5,
          step: 0.01,
        },
        {
          key: "obstacleFlattening",
          kind: "number",
          unit: "%",
          min: 0,
          max: 100,
          step: 5,
        },
      ],
    },
    {
      label: "Transform",
      fields: [{ key: "position", kind: "vec3" }],
    },
  ],
}
