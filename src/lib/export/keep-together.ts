/**
 * Keeps short pieces of text on the same line in exported documents by turning selected
 * spaces into non-breaking spaces (U+00A0). Word, PDF viewers and phone previews all wrap
 * lines themselves, so this is the only way an export can influence where a line ends.
 *
 * Kept together:
 * - "a", "A" and "I" with the word after them, so a single letter never ends a line.
 * - "et al." with the author name before it.
 * - A citation year with what precedes it: ", 2024" or "Smith 2024)" never starts a line.
 * - "p." / "pp." with the page number after them.
 *
 * Long citations can still break between authors, so lines never get large gaps.
 */
const NBSP = " ";

export function keepWordsTogether(text: string): string {
  return (
    text
      // Single-letter words: "a", "A", "I" glued to the next word.
      .replace(/(^|[\s(“"'‘[*_])([aAI]) (?=\S)/g, `$1$2${NBSP}`)
      // "Smith et al." — name, "et" and "al." stay together.
      .replace(/(\S) et al\./g, `$1${NBSP}et${NBSP}al.`)
      // Citation years: ", 2024", ", 2024a", ", n.d." and "Smith 2024)" / "Smith 2024;".
      .replace(/, (?=(?:\d{4}[a-z]?|n\.d\.)(?=[\s),;:.]|$))/g, `,${NBSP}`)
      .replace(/([A-Za-z.]) (?=\d{4}[a-z]?[);,])/g, `$1${NBSP}`)
      // Page references: "p. 12", "pp. 12–15".
      .replace(/\b(pp?\.) (?=\d)/g, `$1${NBSP}`)
  );
}
