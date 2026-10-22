/**
 * Parses a decimal typed into a form: comma and point both work ("85,50", "85.50"), Swiss
 * thousands apostrophes and spaces are ignored ("1'250.50"). Anything else (letters, "1.250,50",
 * several separators) is NaN instead of a silently wrong number.
 */
export function parseDecimalInput(raw: string | null | undefined): number {
  const cleaned = (raw ?? "").trim().replace(/['’\s]/g, "");
  if (!/^\d+([.,]\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned.replace(",", "."));
}
