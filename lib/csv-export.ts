/**
 * Negative amounts such as "-100.00" must stay numeric. A leading "+" is not
 * exempt: Excel treats it as a formula, so "+41791234567" would turn into
 * 4.18E+10 and "+41-79-123-45-67" into -273; those get the apostrophe, which
 * deliberately ranks Excel safety above fidelity for other consumers.
 */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Spreadsheets read a cell starting with = + - @ (or tab/CR) as a formula.
 * Exports carry user-entered text (names, notes, imported data) that the
 * accountant opens in Excel/LibreOffice, so such text gets a leading
 * apostrophe, which spreadsheets display as plain text.
 */
function neutralizeFormula(str: string): string {
  if (/^[=+\-@\t\r]/.test(str) && !PLAIN_NUMBER.test(str)) return `'${str}`;
  return str;
}

function escapeCell(value: unknown): string {
  const str = neutralizeFormula(value == null ? "" : String(value));
  // ";" is the list separator of Swiss-German Excel: an unquoted "Foo;=1+1"
  // would open as two cells, the second one a formula, so it is quoted too.
  if (/[,;"\n\r]/.test(str)) {
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
