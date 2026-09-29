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
