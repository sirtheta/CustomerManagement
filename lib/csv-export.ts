/** Plain (signed) numbers such as "-100.00": amounts must stay numeric. */
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/**
 * International phone numbers ("+41 79 123 45 67"): a leading plus followed by
 * digits and phone separators only. Such a value cannot hold a function, cell
 * reference or DDE command (those need letters or | ! = " '), so it is left
 * readable instead of getting an apostrophe.
 */
const PHONE_NUMBER = /^\+[\d\s()./-]+$/;

/**
 * Spreadsheets read a cell starting with = + - @ (or tab/CR) as a formula.
 * Exports carry user-entered text (names, notes, imported data) that the
 * accountant opens in Excel/LibreOffice, so such text gets a leading
 * apostrophe, which spreadsheets display as plain text.
 */
function neutralizeFormula(str: string): string {
  if (/^[=+\-@\t\r]/.test(str) && !PLAIN_NUMBER.test(str) && !PHONE_NUMBER.test(str)) return `'${str}`;
  return str;
}

function escapeCell(value: unknown): string {
  const str = neutralizeFormula(value == null ? "" : String(value));
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(escapeCell).join(","),
    ...rows.map((row) => row.map(escapeCell).join(",")),
  ];
  return lines.join("\n");
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Exports hold customer and accounting data: keep them out of caches.
      "Cache-Control": "private, no-store",
    },
  });
}
