ALTER TABLE "users" ADD COLUMN "display_name" TEXT NOT NULL DEFAULT '';
UPDATE "users" SET "display_name" = "username" WHERE "display_name" = '';
ALTER TABLE "audit_logs" ADD COLUMN "actor_display_name" TEXT;
ALTER TABLE "file_operation_histories" ADD COLUMN "actor_display_name" TEXT;
ALTER TABLE "user_activity_histories" ADD COLUMN "actor_display_name" TEXT;
