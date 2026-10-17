/**
 * The search box both FeatureManagers carry (E1-P2): a row stays when nothing is typed, or when any
 * of its labels holds the needle. FeatureTree asks it with a feature's name, label, tag and comment;
 * AssemblyTree with a component's name and file, a pattern's name and seed, an exploded step's, and a
 * mate's plus the components it joins. Kept pure and outside the components so the rule that decides
 * what a search shows is testable without a browser (this project's vitest runs in `node`).
 */

/** What a filter box's text stands for: trimmed, case-insensitive — as FeatureTree has always read it. */
export function treeNeedle(filter: string): string {
  return filter.trim().toLowerCase();
}

/** Whether a row survives the search: kept when nothing is typed, else kept when any label holds the needle. Normalizes the needle itself (as `treeNeedle`
 *  does), so a caller that passes the box's raw text still gets a case-insensitive match and a blank box still keeps every row. */
export function treeFilterMatches(needle: string, labels: readonly (string | undefined | null)[]): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  return labels.some((x) => (x ?? '').toLowerCase().includes(n));
}
