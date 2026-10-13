import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The `./agent-tools` contracts are imported wherever a host declares its tools, including
// sandboxed workflows that reject Node and DOM dependencies. So the entry may reach zod and
// this plugin's own dependency-free files only — the rule core's agent-tools follow.
const ENTRY = fileURLToPath(import.meta.resolve('@pascal-app/plugin-environment/agent-tools'))

function runtimeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const specifiers: string[] = []
  for (const match of source.matchAll(
    /^(?:import|export)\s+(?!type\s)[^'"]*?from\s+['"]([^'"]+)['"]/gm,
  )) {
    const specifier = match[1]
    if (specifier) specifiers.push(specifier)
  }
  return specifiers
}

test('the agent-tools export reaches only zod and dependency-free files', () => {
  const seen = new Set<string>()
  const offenders: string[] = []
  const queue = [ENTRY]
  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    for (const specifier of runtimeImports(file)) {
      if (specifier === 'zod') continue
      if (!specifier.startsWith('.')) {
        offenders.push(`${relative(import.meta.dir, file)} imports ${specifier}`)
        continue
      }
      const base = resolve(dirname(file), specifier)
      const next = [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find(existsSync)
      if (next) queue.push(next)
      else offenders.push(`${relative(import.meta.dir, file)} imports ${specifier}, not found`)
    }
  }
  expect(offenders).toEqual([])
})
