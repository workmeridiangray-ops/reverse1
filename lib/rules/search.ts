/**
 * Normalise free-text search before it is placed in a PostgREST filter.
 * Keeps letters, digits, spaces, apostrophes and hyphens; drops everything
 * that has meaning in filter syntax (commas, dots, parentheses, %, *).
 */
export function searchTerm(raw: string | null | undefined, maxLength = 60): string | null {
  if (!raw) return null;
  const cleaned = raw.normalize("NFC").replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
  return cleaned.length >= 1 ? cleaned : null;
}
