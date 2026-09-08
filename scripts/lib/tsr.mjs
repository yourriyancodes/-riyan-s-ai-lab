/** Preload: registers the resolution hooks above. Import with `node --import`. */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./ts-alias-hooks.mjs', { parentURL: pathToFileURL(`${process.cwd()}/scripts/lib/preload.js`).href })
