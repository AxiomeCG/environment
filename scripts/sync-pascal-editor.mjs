import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
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
const watchMode = process.argv.includes('--watch')

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
