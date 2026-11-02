// Test-only ESM resolver hook: Node requires explicit extensions, while the
// Next.js/TypeScript bundler resolves extensionless relative imports.
// This hook retries `./foo` as `./foo.ts` so app code stays idiomatic.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../')
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier)
    if (relative && !hasExtension) {
      return nextResolve(`${specifier}.ts`, context)
    }
    throw error
  }
}
