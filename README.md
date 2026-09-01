# Pascal Environment

`@pascal-app/plugin-environment` is a standalone Pascal plugin for terrain-dependent environment creation.

## Current state

This repository currently contains a mechanical transfer of the GPU Ground Cover prototype that was developed in Pascal Nature. Its public identities are:

- plugin: `pascal:environment`
- package: `@pascal-app/plugin-environment`
- node kind: `environment:ground-cover`

The transfer preserves the prototype's internal `GrassFieldNode` naming and tests to keep this planning pass focused. `GroundCoverNode` is exported as a public alias.

The prototype already provides a persistent RGBA paint field, paint/erase/smooth brushes, deterministic instanced blades, color and density sampling, blade variation, and shader-driven wind. It is not yet integrated into the Pascal editor repository and must not be considered fully compatible with sculpted Terrain or the baked GLB viewer.

## Exports

```ts
import {
  environmentHostPanel,
  environmentPlugin,
  groundCoverDefinition,
  GroundCoverNode,
} from '@pascal-app/plugin-environment'
```

A Pascal host loads `environmentPlugin` through the plugin discovery contract and registers `environmentHostPanel` separately through the editor host-panel registry.

## Development

```sh
bun install
bun test
bun run check-types
```

The package targets Pascal `1.0.0-beta.5` or newer within the `1.x` plugin API.

## Scope

Environment is intended to own large-scale brushes, masks, distributions, terrain-dependent water, atmosphere, surroundings, and environmental LOD. Nature remains responsible for procedural individual vegetation and EZ-Tree-specific behavior. The implementation sequence beyond the transferred Ground Cover prototype is intentionally deferred until the six-day mission plan is approved.

## License

MIT
