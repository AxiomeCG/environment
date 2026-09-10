import { lstat, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

// Turbopack cannot parse Bun's file-dependency manifest symlinks as package JSON.
for (const [name, specifier] of Object.entries(manifest.dependencies)) {
  if (!specifier.startsWith('file:')) continue
  const filename = path.join(root, 'node_modules', name, 'package.json')
  if (!(await lstat(filename)).isSymbolicLink()) continue
  const contents = await readFile(filename)
  await unlink(filename)
  await writeFile(filename, contents)
}
