-- Named "3_" on purpose: migrations apply in name order and the legacy
-- "2_add_password_reset_token" sorts after every timestamped folder and
-- rebuilds "User", which would drop a column added by an earlier-sorting one.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "totpLastStep" INTEGER;
