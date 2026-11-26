/**
 * i18next number-interpolation formatter, shared by every i18next instance
 * that formats numbers through `formatSI`.
 *
 * Its own module so an i18next init can reuse the number-format rule WITHOUT
 * pulling in the rest of `./index.ts`.
 */
import type { FormatFunction, FormatterModule } from 'i18next';
import { formatSI } from '../utils/formatSI';

// Placeholder names whose values are numeric IDENTIFIERS, not quantities —
// grouping "row 1234" into "row 1 234" would corrupt them: {{id}}, {{cid}},
// {{jobId}}, {{version}} / {{v}} (ids and revision numbers), plus {{year}} — years are
// exactly the 4-digit magnitude where grouping kicks in.
// `rank` / `page` / `totalPages` are ordinals and positions rather than
// quantities: under the SI style a space-grouped "Rank 1 234" reads as two
// separate numbers. `total` deliberately stays OUT — it is a genuine count
// ("total 12 345 items"), where grouping is the point (PT-6918).
const UNGROUPED_PLACEHOLDERS = new Set([
  'id', 'cid', 'jobId', 'version', 'v', 'year', 'rank', 'page', 'totalPages',
]);

/**
 * Interpolated numbers ({{count}} and friends) follow the number-format
 * style preference via formatSI.
 *
 * A formatter MODULE, not the `interpolation.format` init option: i18next
 * v21+ unconditionally replaces that option with its built-in Intl formatter
 * at init, so the option would be silently ignored. `alwaysFormat: true`
 * at the init site routes bare (spec-less) placeholders through here too; an
 * explicit spec ({{count, number}}) lands here as well. Exported so a test
 * can wire it into a standalone instance.
 */
export const numberFormatter: FormatterModule = {
  type: 'formatter',
  init() {},
  add() {},
  addCached() {},
  // Cast: FormatFunction declares `=> string`, but pass-through values must
  // leave untouched — in particular `undefined` must stay `undefined` so
  // missing-interpolation handling still fires. i18next's own Formatter
  // returns the raw value the same way when no format applies.
  format: ((value: unknown, format?: string, _lng?: string, options?: { interpolationkey?: string }) => {
    // Only genuine numbers: values stringified upstream (PDB IDs, version
    // strings, pre-formatted dates/durations) must never be re-grouped.
    if (typeof value !== 'number' || !Number.isFinite(value)) return value;
    // An explicit spec other than `number` (`{{d, datetime}}`, `{{x, currency}}`,
    // …) asks for semantics this module does not implement, and translations can
    // change at runtime — so pass those through untouched rather than
    // silently rendering them as a plain grouped number. Only bare placeholders
    // and an explicit `number` follow the number-format style preference.
    const spec = format?.trim().toLowerCase();
    if (spec && spec !== 'number') return value;
    if (options?.interpolationkey !== undefined && UNGROUPED_PLACEHOLDERS.has(options.interpolationkey)) {
      return value;
    }
    return formatSI(value);
  }) as FormatFunction,
};
