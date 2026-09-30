const normalizeIban = (iban: string) => iban.replace(/\s/g, "").toUpperCase();

/**
 * Compares the account a statement belongs to with the company's own account.
 * Returns user-facing warnings only; the import stays possible because a
 * mismatch may be intentional (e.g. a second account).
 */
export function checkStatementAccount(
  statement: { currency: string | null; iban: string | null },
  companyIban: string | null
): string[] {
  const warnings: string[] = [];

  if (statement.currency && statement.currency.toUpperCase() !== "CHF") {
    warnings.push(
      `Der Kontoauszug lautet auf ${statement.currency}, Rechnungen sind in CHF. Beträge werden nicht umgerechnet.`
    );
  }

  if (
    statement.iban &&
    companyIban &&
    normalizeIban(statement.iban) !== normalizeIban(companyIban)
  ) {
    warnings.push(
      `Die IBAN des Kontoauszugs (${statement.iban}) stimmt nicht mit der IBAN in den Einstellungen überein.`
    );
  }

  return warnings;
}

const chf = (cents: number) => (Math.abs(cents) / 100).toFixed(2);

/**
 * Opening balance plus all movements must equal the closing balance,
 * otherwise entries are missing from (or were skipped in) the file.
 */
export function checkBalanceCompleteness(statement: {
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  transactions: { amountCents: number }[];
}): string[] {
  if (statement.openingBalanceCents === null || statement.closingBalanceCents === null) return [];
  const sum = statement.transactions.reduce((total, t) => total + t.amountCents, 0);
  const difference = statement.closingBalanceCents - (statement.openingBalanceCents + sum);
  if (difference === 0) return [];
  return [
    `Saldoprüfung: Anfangssaldo plus Bewegungen ergibt nicht den Endsaldo (Differenz CHF ${chf(difference)}). Der Kontoauszug ist vermutlich unvollständig.`,
  ];
}

/**
 * The opening balance should continue where the previous import for the same
 * account ended; a gap usually means a month was never imported.
 */
export function checkBalanceContinuity(
  openingBalanceCents: number | null,
  previous: { closingBalanceRappen: number | null; periodTo: string | null } | null
): string[] {
  if (openingBalanceCents === null || !previous || previous.closingBalanceRappen === null) {
    return [];
  }
  if (openingBalanceCents === previous.closingBalanceRappen) return [];
  const difference = openingBalanceCents - previous.closingBalanceRappen;
  return [
    `Der Anfangssaldo weicht vom Endsaldo des letzten Imports${previous.periodTo ? ` (bis ${previous.periodTo})` : ""} ab (Differenz CHF ${chf(difference)}). Möglicherweise fehlt ein Zeitraum.`,
  ];
}
