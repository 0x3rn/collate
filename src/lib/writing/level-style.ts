/**
 * One extra drafting instruction that sets how complex the writing should be for the academic
 * level chosen in setup. It is appended to the drafting prompt; it never replaces the evidence
 * rules. Without it every level read like a doctoral thesis.
 */

const PLAIN_WORDS =
  'Prefer plain words to inflated ones ("use" not "utilise", "show" not "elucidate", "help" not "facilitate").';

export function writingStyleForLevel(level: string | null | undefined): string {
  const l = (level ?? "").toLowerCase();

  if (/high school|secondary|senior school|a-level|a level|waec|ssce/.test(l)) {
    return [
      "WRITING LEVEL (secondary school): Write so a strong secondary-school student could have written it and any classmate can follow it.",
      "Use clear, everyday vocabulary and mostly short sentences (about 12 to 20 words). Explain any technical term in simple words the first time it appears.",
      `Avoid academic jargon, long chains of clauses and abstract nouns. ${PLAIN_WORDS} Keep a formal, school-report tone: clear and correct, never childish or chatty.`,
    ].join(" ");
  }

  if (/diploma|hnd|ond|certificate/.test(l)) {
    return [
      "WRITING LEVEL (diploma / HND): Write in clear, practical academic English.",
      "Use mostly short to medium sentences and explain specialised terms briefly when they first appear.",
      `Avoid dense jargon and ornate phrasing. ${PLAIN_WORDS}`,
    ].join(" ");
  }

  if (/phd|doctor/.test(l)) {
    return [
      "WRITING LEVEL (doctoral): Use a precise, critical academic register suitable for a doctoral thesis.",
      "Technical vocabulary and complex arguments are expected, but keep each sentence readable and avoid needless wordiness.",
    ].join(" ");
  }

  if (/master|msc|mba|ma\b|postgraduate/.test(l)) {
    return [
      "WRITING LEVEL (master's): Use a precise academic register with clear structure.",
      "Use technical terms without over-explaining, but avoid needless complexity, padding and inflated vocabulary.",
    ].join(" ");
  }

  if (/professional|independent/.test(l)) {
    return [
      "WRITING LEVEL (professional): Write clearly for an informed reader who is not a specialist in this field.",
      `Be precise but accessible, explain specialised terms briefly, and avoid academic jargon. ${PLAIN_WORDS}`,
    ].join(" ");
  }

  // Undergraduate, and the default when no level was chosen.
  return [
    "WRITING LEVEL (undergraduate): Write like a strong final-year undergraduate, not a doctoral thesis.",
    "Balance academic and plain vocabulary, keep most sentences to a medium length, and briefly explain specialised terms the first time they appear.",
    `Avoid dense jargon, stacked clauses and showy words. ${PLAIN_WORDS}`,
  ].join(" ");
}
