-- Migration: add_machine_serial_location_dnc
-- Adds serial_number, location, dnc_config columns to machines table

-- AlterTable
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "serial_number" TEXT;
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "dnc_config" JSONB NOT NULL DEFAULT '{}';
