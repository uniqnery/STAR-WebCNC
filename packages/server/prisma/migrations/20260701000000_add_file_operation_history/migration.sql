CREATE TABLE "file_operation_histories" (
  "id" TEXT NOT NULL,
  "machine_id" TEXT,
  "machine_code" TEXT,
  "operation_type" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_names" JSONB,
  "path" TEXT,
  "status" TEXT NOT NULL,
  "correlation_id" TEXT,
  "user_id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "error_message" TEXT,
  "file_size_before" INTEGER,
  "file_size_after" INTEGER,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "file_operation_histories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "file_operation_histories_machine_code_started_at_idx"
  ON "file_operation_histories"("machine_code", "started_at");

CREATE INDEX "file_operation_histories_machine_id_started_at_idx"
  ON "file_operation_histories"("machine_id", "started_at");

CREATE INDEX "file_operation_histories_correlation_id_idx"
  ON "file_operation_histories"("correlation_id");

CREATE INDEX "file_operation_histories_user_id_started_at_idx"
  ON "file_operation_histories"("user_id", "started_at");

ALTER TABLE "file_operation_histories"
  ADD CONSTRAINT "file_operation_histories_machine_id_fkey"
  FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "file_operation_histories"
  ADD CONSTRAINT "file_operation_histories_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;