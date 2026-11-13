/**
 * Render-entry boundary gate: bundles `./render` with Bun.build (every static
 * and lazy `import()` edge, peer dependencies included) and fails if anything in
 * the graph resolves to `@pascal-app/editor` or `next`. As a self-test it first
 * bundles the root entry, which must reach the editor; a gate that cannot see
 * that import would pass anything.
 *
 *   bun run check:render              # self-test, then check ./render
 *   bun run check:render src/foo.ts   # report editor/next reach from any module
 */
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BunPlugin } from 'bun'

const FORBIDDEN = /^(?:@pascal-app\/editor|next)(?:\/|$)/
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = await Bun.file(resolve(root, 'package.json')).json()

type Hit = { specifier: string; chain: string }

async function forbiddenImports(entry: string): Promise<Hit[]> {
  const importerOf = new Map<string, string>()
  const display = (path: string) => relative(root, path) || path
  const chain = (importer: string) => {
    const steps: string[] = []
    for (let at: string | undefined = importer; at; at = importerOf.get(at)) {
      steps.unshift(display(at))
      if (steps.length > 40) break
    }
    return steps.join(' -> ')
  }
  const hits: Hit[] = []
  const gate: BunPlugin = {
    name: 'render-entry-gate',
    setup(build) {
      build.onResolve({ filter: FORBIDDEN }, (args) => {
        hits.push({ specifier: args.path, chain: chain(args.importer) })
        return { path: args.path, external: true }
      })
      // Records who first imported each local module, for the report's import chain.
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        try {
          const path = Bun.resolveSync(args.path, dirname(args.importer))
          if (!importerOf.has(path)) importerOf.set(path, args.importer)
        } catch {}
        return undefined
      })
    },
  }
  const result = await Bun.build({
    entrypoints: [resolve(root, entry)],
    target: 'browser',
    format: 'esm',
    splitting: true,
    loader: { '.webp': 'file', '.png': 'file', '.svg': 'file' },
    plugins: [gate],
    throw: false,
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`bundling ${entry} failed`)
  }
  return hits
}

function print(label: string, hits: Hit[]) {
  console.log(`${label}: ${hits.length} forbidden import(s)`)
  for (const hit of hits) console.log(`  ${hit.specifier}  (via ${hit.chain})`)
}

const probe = process.argv[2]
if (probe) {
  print(probe, await forbiddenImports(probe))
  process.exit(0)
}

const rootEntry = pkg.exports['.'].default as string
const renderEntry = pkg.exports['./render'].default as string

const probeHits = await forbiddenImports(rootEntry)
if (!probeHits.some((hit) => hit.specifier.startsWith('@pascal-app/editor'))) {
  console.error(`Self-test failed: the root entry (${rootEntry}) should reach @pascal-app/editor.`)
  process.exit(1)
}
console.log(
  `Self-test: the root entry reaches the editor (${probeHits.length} import(s)), as expected.`,
)

const renderHits = await forbiddenImports(renderEntry)
print(renderEntry, renderHits)
if (renderHits.length > 0) {
  console.error('The ./render entry must not reach @pascal-app/editor or next.')
  process.exit(1)
}
