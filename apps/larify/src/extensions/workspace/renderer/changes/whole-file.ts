/**
 * Classifies a diff whose one side is empty, so the changes view can render it
 * with a plain read-only editor instead of the diff editor.
 *
 * Why: the diff editor paints the content with an insertion decoration on
 * whichever side happens to be non-empty, which makes a deleted file read as
 * an addition. Rendering it separately lets each direction carry its own
 * highlight colour.
 *
 * Kept out of the component module so React Fast Refresh keeps working
 * (a module that exports components must not export anything else).
 */

/** A file whose whole content was added or removed. */
export type WholeFile = 'added' | 'removed'

/**
 * Returns the whole-file direction, or null when the diff should stay on the
 * diff editor: split mode keeps both sides, and two empty sides are not a
 * whole-file change (and must not be painted as one).
 */
export const classifyWholeFile = (
  mode: 'unified' | 'split',
  original: string,
  modified: string
): WholeFile | null => {
  if (mode !== 'unified') return null
  if (original === '' && modified === '') return null
  if (original === '') return 'added'
  if (modified === '') return 'removed'
  return null
}
