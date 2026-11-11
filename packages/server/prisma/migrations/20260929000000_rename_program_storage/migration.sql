ALTER TABLE "machines" RENAME COLUMN "dnc_config" TO "program_transfer_config";

ALTER TABLE "dnc_programs" RENAME TO "program_repository_files";
ALTER TABLE "program_repository_files" RENAME CONSTRAINT "dnc_programs_pkey" TO "program_repository_files_pkey";
ALTER TABLE "program_repository_files" RENAME CONSTRAINT "dnc_programs_machine_id_fkey" TO "program_repository_files_machine_id_fkey";
ALTER TABLE "program_repository_files" RENAME CONSTRAINT "dnc_programs_uploaded_by_id_fkey" TO "program_repository_files_uploaded_by_id_fkey";
ALTER INDEX "dnc_programs_machine_id_program_no_key" RENAME TO "program_repository_files_machine_id_program_no_key";
ALTER INDEX "dnc_programs_machine_id_updated_at_idx" RENAME TO "program_repository_files_machine_id_updated_at_idx";
