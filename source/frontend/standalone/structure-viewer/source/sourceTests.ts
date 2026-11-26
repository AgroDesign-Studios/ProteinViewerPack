import { posix } from 'node:path'
import extract from './extract.json' with { type: 'json' }

const TEST = /\.(test|spec)\.tsx?$/
/** A repository path as a path under frontend/. */
const underFrontend = (p: string): string => posix.relative('frontend', p)

/**
 * The test files of the viewer's published source, as Vitest `include`
 * paths under frontend/: those `extract.json` names one by one (it names
 * every published file so: PT-10171). vitest.config.ts beside this runs them;
 * extract.test.ts checks they are every declared test.
 */
export const SOURCE_TESTS: readonly string[] = Object.freeze(
  extract.files.filter(f => f.startsWith('frontend/') && TEST.test(f)).map(underFrontend),
)
