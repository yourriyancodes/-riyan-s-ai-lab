/**
 * Regenerate `db/schema.sql` from `lib/raven/db/schema.ts`.
 *
 * The TypeScript file is the single source of truth — the adapters and the migration
 * text are built from the same array, so they cannot disagree. This script exists so
 * the readable `.sql` artefact (for a Supabase SQL editor or `psql -f`) stays a
 * generated copy rather than a second hand-edited version that drifts.
 *
 *   npm run schema          # rewrite db/schema.sql
 *   npm run schema:check    # fail if it is stale (part of `npm run check`)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const { SCHEMA_SQL } = await import(`${root}/lib/raven/db/schema.ts`)

const target = join(root, 'db', 'schema.sql')
await mkdir(dirname(target), { recursive: true })

const existing = await readFile(target, 'utf8').catch(() => null)
if (existing === SCHEMA_SQL) {
  console.log('db/schema.sql is in sync with lib/raven/db/schema.ts')
  process.exit(0)
}

if (process.argv.includes('--verify')) {
  console.error('db/schema.sql is STALE — run `npm run schema` after editing lib/raven/db/schema.ts')
  process.exit(1)
}

await writeFile(target, SCHEMA_SQL, 'utf8')
console.log(`wrote ${target.replace(root + '/', '')} (${SCHEMA_SQL.split('\n').length} lines)`)
