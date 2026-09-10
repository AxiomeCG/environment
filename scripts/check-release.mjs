import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  console.log(`Check Environment against published, installed Pascal host packages.
No packages are published and no files are changed.

Usage: bun run check:release
For an unreleased local host, use bun run check-types:pascal instead.

Examples:
  bun run check:release
  bun scripts/check-release.mjs --help`)
  process.exit(0)
}
if (args.length > 0) throw new Error('Unexpected arguments. Run with --help for usage.')

const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
for (const name of ['@pascal-app/core', '@pascal-app/editor', '@pascal-app/viewer']) {
  const range = manifest.peerDependencies[name]
  const published = spawnSync('npm', ['view', `${name}@${range}`, 'version', '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (published.error || published.status !== 0) {
    throw new Error(
      `Cannot verify a published ${name}@${range}. Release the required host APIs first, then align Environment's peer minimum and installed development dependency with that release. Local development remains available through check-types:pascal and test:pascal.`,
      { cause: published.error ?? published.stderr.trim() },
    )
  }
  const versions = JSON.parse(published.stdout)
  const supported = Array.isArray(versions) ? versions : [versions]
  const installed = JSON.parse(
    await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'),
  )
  if (!supported.includes(installed.version)) {
    throw new Error(
      `${name}@${installed.version} is installed, but release validation requires a published version matching ${range}. Install the compatible host development dependencies before retrying.`,
    )
  }
  console.log(`${name}@${installed.version}: published and within ${range}`)
}

const result = spawnSync(process.execPath, ['run', 'check-types'], {
  cwd: root,
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
