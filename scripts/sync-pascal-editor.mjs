import { spawnSync } from 'node:child_process'
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const environmentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const editorRoot = path.resolve(
  process.env.PASCAL_EDITOR_ROOT ?? path.join(environmentRoot, '..', 'editor')
)
const sourceDirectory = path.join(environmentRoot, 'src')
const packageDirectory = path.join(
  editorRoot,
  'apps',
  'editor',
  'node_modules',
  '@pascal-app',
  'plugin-environment'
)
const targetDirectory = path.join(packageDirectory, 'src')
const stagingDirectory = path.join(packageDirectory, '.environment-src-next')
const previousDirectory = path.join(packageDirectory, '.environment-src-previous')
const [mode, ...testPaths] = process.argv.slice(2)
const watchMode = mode === '--watch'

if (mode === '--help') {
  console.log(`Mirror Environment into an installed Pascal editor, or pack the integration candidate.

Usage: bun scripts/sync-pascal-editor.mjs [--watch | --check-types | --test [paths...] | --pack]
Set PASCAL_EDITOR_ROOT for a non-sibling editor checkout.

Examples:
  bun run sync:pascal
  bun run dev:pascal
  bun run check-types:pascal
  bun run test:pascal src/ground-cover/geometry.test.ts
  bun run pack:pascal

Only --pack writes a tracked candidate archive; source mirroring leaves tracked files unchanged.`)
  process.exit(0)
}
if (
  (mode && !['--watch', '--check-types', '--test', '--pack'].includes(mode)) ||
  (testPaths.length > 0 && mode !== '--test')
) {
  throw new Error('Unexpected arguments. Run "bun scripts/sync-pascal-editor.mjs --help".')
}

if (mode === '--pack') {
  const appRoot = path.join(editorRoot, 'apps', 'editor')
  const app = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'))
  const dependency = app.dependencies?.['@pascal-app/plugin-environment']
  if (typeof dependency !== 'string' || !dependency.startsWith('file:vendor/') || !dependency.endsWith('.tgz')) {
    throw new Error('Editor must declare an Environment candidate under file:vendor/*.tgz before packing.')
  }
  const archive = path.resolve(appRoot, dependency.slice('file:'.length))
  if (!archive.startsWith(`${path.join(appRoot, 'vendor')}${path.sep}`)) {
    throw new Error('The candidate archive must stay inside the editor app vendor directory.')
  }
  await mkdir(path.dirname(archive), { recursive: true })
  const result = spawnSync(
    process.execPath,
    ['pm', 'pack', '--ignore-scripts', '--quiet', '--filename', archive],
    { cwd: environmentRoot, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

async function pathExists(candidate) {
  try {
    await lstat(candidate)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function assertInstalledHostPackage() {
  const manifestPath = path.join(packageDirectory, 'package.json')
  let manifest

  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `Pascal Environment is not installed at ${packageDirectory}. Run "bun install" from ${editorRoot} first.`
      )
    }
    throw error
  }

  if (manifest.name !== '@pascal-app/plugin-environment') {
    throw new Error(`Unexpected package at ${packageDirectory}: ${manifest.name}`)
  }

  const runtimeDependencies = Object.keys(manifest.dependencies ?? {})
  if (runtimeDependencies.length > 0) {
    throw new Error(
      `Local mirroring requires Environment runtime dependencies to be host-provided peers; found: ${runtimeDependencies.join(', ')}`
    )
  }

  // Bun materializes local file dependencies with symlinks and their development
  // graph. Rebuild a plain in-workspace package so Turbopack and peer resolution
  // stay inside the Pascal host.
  await rm(packageDirectory, { recursive: true, force: true })
  await mkdir(packageDirectory, { recursive: true })
  await cp(path.join(environmentRoot, 'package.json'), manifestPath)
}

async function syncSource() {
  await rm(stagingDirectory, { recursive: true, force: true })
  await cp(sourceDirectory, stagingDirectory, { recursive: true })
  await rm(previousDirectory, { recursive: true, force: true })

  if (await pathExists(targetDirectory)) {
    await rename(targetDirectory, previousDirectory)
  }

  await rename(stagingDirectory, targetDirectory)
  await rm(previousDirectory, { recursive: true, force: true })
  console.log(`Synced Environment source to ${targetDirectory}`)
}

async function sourceFingerprint(directory = sourceDirectory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const parts = []

  entries.sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      parts.push(await sourceFingerprint(entryPath))
      continue
    }

    const metadata = await stat(entryPath)
    parts.push(
      `${path.relative(sourceDirectory, entryPath)}:${metadata.ino}:${metadata.mtimeMs}:${metadata.size}`
    )
  }

  return parts.join('|')
}

await assertInstalledHostPackage()
await syncSource()

if (mode === '--check-types' || mode === '--test') {
  const configPath = path.join(packageDirectory, '.tsconfig.local.json')
  const args =
    mode === '--test'
      ? ['test', ...(testPaths.length > 0 ? testPaths : ['src'])]
      : [
          path.join(environmentRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
          '--project',
          configPath,
        ]
  try {
    if (mode === '--check-types') {
      await writeFile(
        configPath,
        JSON.stringify({
          extends: path.join(environmentRoot, 'tsconfig.json'),
          compilerOptions: { rootDir: editorRoot },
          include: ['./src'],
          exclude: ['node_modules'],
        }),
      )
    }
    const result = spawnSync(process.execPath, args, {
      cwd: packageDirectory,
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally {
    await rm(configPath, { force: true })
  }
}

if (watchMode) {
  console.log(`Watching ${sourceDirectory}`)

  let fingerprint = await sourceFingerprint()
  let checking = false
  const timer = setInterval(async () => {
    if (checking) {
      return
    }

    checking = true
    try {
      const nextFingerprint = await sourceFingerprint()
      if (nextFingerprint !== fingerprint) {
        fingerprint = nextFingerprint
        await syncSource()
      }
    } catch (error) {
      console.error(error)
    } finally {
      checking = false
    }
  }, 250)

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      clearInterval(timer)
      process.exit(0)
    })
  }
}
