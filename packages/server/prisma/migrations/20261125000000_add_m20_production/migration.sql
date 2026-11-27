BEGIN;
ALTER TABLE "scheduler_rows" ADD COLUMN "production_comment" TEXT;
ALTER TABLE "work_orders" ADD COLUMN "production_comment" TEXT;
ALTER TABLE "production_logs"
 ADD COLUMN "event_id" TEXT,
 ADD COLUMN "production_name" TEXT,
 ADD COLUMN "comment_source" TEXT,
 ADD COLUMN "scheduler_comment" TEXT,
 ADD COLUMN "mes_comment" TEXT,
 ADD COLUMN "scheduler_row_id" TEXT,
 ADD COLUMN "work_order_id" TEXT,
 ADD COLUMN "work_order_number" TEXT,
 ADD COLUMN "product_code" TEXT,
 ADD COLUMN "executing_program_no" TEXT,
 ADD COLUMN "run_key" TEXT,
 ADD COLUMN "context_status" TEXT NOT NULL DEFAULT 'legacy';
CREATE UNIQUE INDEX "production_logs_event_id_key" ON "production_logs"("event_id");
CREATE TABLE "production_policies" (
 "id" TEXT PRIMARY KEY, "enabled" BOOLEAN NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "changed_by" TEXT NOT NULL
);
CREATE INDEX "production_policies_created_at_idx" ON "production_policies"("created_at");
CREATE TABLE "production_assignments" (
 "id" TEXT PRIMARY KEY, "machine_code" TEXT NOT NULL, "work_order_id" TEXT NOT NULL,
 "order_number" TEXT NOT NULL, "product_code" TEXT NOT NULL, "production_comment" TEXT NOT NULL,
 "program_no" TEXT NOT NULL, "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "ended_at" TIMESTAMP(3)
);
CREATE INDEX "production_assignments_machine_code_started_at_idx" ON "production_assignments"("machine_code", "started_at");
CREATE UNIQUE INDEX "production_assignments_active_machine" ON "production_assignments"("machine_code") WHERE "ended_at" IS NULL;
COMMIT;
