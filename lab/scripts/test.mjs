import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nextConfig from '../next.config.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const paths = { '@/*': [path.join(root, '*')] }
for (const [name, target] of Object.entries(nextConfig.turbopack.resolveAlias)) {
  paths[name] = [path.resolve(root, target)]
  if (name === 'react' || name === 'react-dom') {
    paths[`${name}/*`] = [path.resolve(root, target, '*')]
  }
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'environment-lab-test-'))
try {
  const config = path.join(directory, 'tsconfig.json')
  await writeFile(config, JSON.stringify({ compilerOptions: { jsx: 'react-jsx', paths } }))
  const result = spawnSync(process.execPath, ['test', '--tsconfig-override', config, 'lib'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
