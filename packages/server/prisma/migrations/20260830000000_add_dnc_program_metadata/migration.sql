ALTER TABLE "scheduler_rows"
  ADD COLUMN "main_program_comment" TEXT,
  ADD COLUMN "main_program_sha256" TEXT;

ALTER TABLE "production_logs"
  ADD COLUMN "program_comment" TEXT,
  ADD COLUMN "program_sha256" TEXT;

CREATE TABLE "dnc_programs" (
  "id" TEXT NOT NULL,
  "machine_id" TEXT NOT NULL,
  "program_no" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "original_file_name" TEXT NOT NULL,
  "comment" TEXT NOT NULL DEFAULT '',
  "file_size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "uploaded_by_id" TEXT NOT NULL,
  "uploaded_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dnc_programs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dnc_programs_machine_id_program_no_key" ON "dnc_programs"("machine_id", "program_no");
CREATE INDEX "dnc_programs_machine_id_updated_at_idx" ON "dnc_programs"("machine_id", "updated_at");
ALTER TABLE "dnc_programs" ADD CONSTRAINT "dnc_programs_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dnc_programs" ADD CONSTRAINT "dnc_programs_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
