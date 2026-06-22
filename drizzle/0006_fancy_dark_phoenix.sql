ALTER TABLE "settings" DROP COLUMN "tool_output";--> statement-breakpoint
-- Data cleanup: drop the vestigial `currency` key from the pricing jsonb.
-- UsagePricing never had a currency field (the usage view hardcodes "$"), so any
-- stored `currency` is dead data. Guarded so only rows that actually have the
-- key are rewritten, and null pricing is left untouched.
UPDATE "settings" SET "pricing" = "pricing" - 'currency' WHERE "pricing" ? 'currency';
