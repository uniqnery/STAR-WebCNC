CREATE TABLE IF NOT EXISTS "user_activity_histories" (
  "id" TEXT NOT NULL,
  "machine_id" TEXT,
  "machine_code" TEXT NOT NULL,
  "page" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "actor_username" TEXT,
  "actor_role" TEXT,
  "action" TEXT NOT NULL,
  "detail" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_activity_histories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_activity_histories_machine_code_page_created_at_idx" ON "user_activity_histories"("machine_code", "page", "created_at");
CREATE INDEX IF NOT EXISTS "user_activity_histories_machine_id_page_created_at_idx" ON "user_activity_histories"("machine_id", "page", "created_at");
CREATE INDEX IF NOT EXISTS "user_activity_histories_actor_user_id_created_at_idx" ON "user_activity_histories"("actor_user_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "user_activity_histories"
    ADD CONSTRAINT "user_activity_histories_machine_id_fkey"
    FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "user_activity_histories"
    ADD CONSTRAINT "user_activity_histories_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;