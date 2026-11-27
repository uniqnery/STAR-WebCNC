BEGIN;
ALTER TABLE "production_logs" ADD COLUMN "count_source" TEXT NOT NULL DEFAULT 'm20', ADD COLUMN "count_quality" TEXT NOT NULL DEFAULT 'confirmed';
CREATE TABLE "production_counter_events" (
 "event_id" TEXT PRIMARY KEY, "machine_code" TEXT NOT NULL,
 "observed_at" TIMESTAMP(3) NOT NULL, "previous_at" TIMESTAMP(3), "interval_state" TEXT NOT NULL,
 "kind" TEXT NOT NULL, "quality" TEXT NOT NULL, "quantity" INTEGER NOT NULL DEFAULT 0,
 "count_before" INTEGER, "count_after" INTEGER, "preset_before" INTEGER, "preset_after" INTEGER,
 "program_no" TEXT, "program_comment" TEXT, "correlation_id" TEXT, "actor" TEXT, "reason" TEXT,
 "raw" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "production_counter_events_machine_code_observed_at_idx" ON "production_counter_events"("machine_code", "observed_at");
COMMIT;
