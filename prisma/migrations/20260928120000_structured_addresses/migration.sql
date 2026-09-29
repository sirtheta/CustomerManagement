-- Swiss QR-bill (Implementation Guidelines 2.x) only accepts structured
-- addresses: street and building number in separate fields, plus a country.
-- Existing free-text addresses are split heuristically: the last
-- whitespace-separated token becomes the house number when it starts with a
-- digit ("Musterstrasse 12a" -> "Musterstrasse" / "12a"). Anything else stays
-- entirely in the street field. Every migrated row is flagged for review so
-- the user can confirm the split in the UI (saving the record clears the flag).

-- ── Customer ────────────────────────────────────────────────────────────
ALTER TABLE "Customer" RENAME COLUMN "address" TO "street";
ALTER TABLE "Customer" ADD COLUMN "houseNumber" TEXT;
ALTER TABLE "Customer" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'CH';
ALTER TABLE "Customer" ADD COLUMN "addressNeedsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "_sp" INTEGER;

UPDATE "Customer" SET "street" = trim("street");

-- Position of the last space (0 when there is none).
UPDATE "Customer" SET "_sp" = (
  WITH RECURSIVE r(i) AS (
    SELECT length("Customer"."street")
    UNION ALL
    SELECT i - 1 FROM r WHERE i > 0 AND substr("Customer"."street", i, 1) <> ' '
  )
  SELECT min(i) FROM r
);

UPDATE "Customer" SET
  "houseNumber" = substr("street", "_sp" + 1),
  "street" = trim(substr("street", 1, "_sp"))
WHERE "_sp" > 1 AND substr("street", "_sp" + 1) GLOB '[0-9]*';

UPDATE "Customer" SET "addressNeedsReview" = true WHERE "street" <> '';
ALTER TABLE "Customer" DROP COLUMN "_sp";

-- ── CompanyInformation ──────────────────────────────────────────────────
ALTER TABLE "CompanyInformation" RENAME COLUMN "companyAddress" TO "companyStreet";
ALTER TABLE "CompanyInformation" ADD COLUMN "companyHouseNumber" TEXT;
ALTER TABLE "CompanyInformation" ADD COLUMN "companyCountry" TEXT NOT NULL DEFAULT 'CH';
ALTER TABLE "CompanyInformation" ADD COLUMN "companyAddressNeedsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompanyInformation" ADD COLUMN "_sp" INTEGER;

UPDATE "CompanyInformation" SET "companyStreet" = trim("companyStreet")
WHERE "companyStreet" IS NOT NULL;

UPDATE "CompanyInformation" SET "_sp" = (
  WITH RECURSIVE r(i) AS (
    SELECT length("CompanyInformation"."companyStreet")
    UNION ALL
    SELECT i - 1 FROM r
    WHERE i > 0 AND substr("CompanyInformation"."companyStreet", i, 1) <> ' '
  )
  SELECT min(i) FROM r
)
WHERE "companyStreet" IS NOT NULL;

UPDATE "CompanyInformation" SET
  "companyHouseNumber" = substr("companyStreet", "_sp" + 1),
  "companyStreet" = trim(substr("companyStreet", 1, "_sp"))
WHERE "_sp" > 1 AND substr("companyStreet", "_sp" + 1) GLOB '[0-9]*';

UPDATE "CompanyInformation" SET "companyAddressNeedsReview" = true
WHERE "companyStreet" IS NOT NULL AND "companyStreet" <> '';
ALTER TABLE "CompanyInformation" DROP COLUMN "_sp";
