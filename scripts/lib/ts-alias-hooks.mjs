/**
 * Module-resolution hooks for running the TypeScript brain under plain `node`.
 *
 * The project has no test runner — deliberately, a `node --experimental-strip-types`
 * script is enough for a repo this size and keeps `npm install` free of a test
 * framework. Stripping types is not the missing piece though: Node also refuses to
 * resolve the extensionless and `@/`-aliased specifiers that TypeScript (and Next's
 * bundler) accept. These two hooks add exactly that resolution, and nothing else.
 */
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..')

const firstExisting = (candidates) => candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile())

export async function resolve(specifier, context, nextResolve) {
  // Relative specifier that omitted its extension: try .ts, then the folder index.
  if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : path.join(repoRoot, 'x.ts')
    const base = path.resolve(path.dirname(parentPath), specifier)
    const found = firstExisting([`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')])
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true }
  }
  if (specifier.startsWith('@/')) {
    const base = path.resolve(repoRoot, specifier.slice(2))
    const found = firstExisting([`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')])
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
