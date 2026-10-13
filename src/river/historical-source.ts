import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPOSITORY_ROOT = resolve(import.meta.dir, '../..')

/**
 * This plugin's `src/` as it was at an earlier commit, extracted with
 * `git archive` into a temporary directory that shares this checkout's
 * dependencies. Only the opt-in historical differential test uses it, to
 * rebuild the frozen fixtures from the real earlier code; it needs the
 * commit in the repository's history (a shallow clone will not have it).
 */
export type HistoricalSource = Readonly<{
  /** Import a module by its path from the repository root, e.g. `src/river/terrain.ts`. */
  load: (modulePath: string) => Promise<Record<string, unknown>>
  dispose: () => void
}>

export function extractSourceAt(commit: string): HistoricalSource {
  const directory = mkdtempSync(join(tmpdir(), `river-source-${commit}-`))
  const dispose = () => rmSync(directory, { recursive: true, force: true })
  try {
    const archive = join(directory, 'src.tar')
    execFileSync('git', ['-C', REPOSITORY_ROOT, 'archive', `--output=${archive}`, commit, 'src'])
    execFileSync('tar', ['-x', '-f', archive, '-C', directory])
    symlinkSync(join(REPOSITORY_ROOT, 'node_modules'), join(directory, 'node_modules'))
  } catch (cause) {
    dispose()
    throw new Error(`Cannot extract src/ at ${commit}; it needs that commit in git history.`, {
      cause,
    })
  }
  return { load: (modulePath) => import(join(directory, modulePath)), dispose }
}
