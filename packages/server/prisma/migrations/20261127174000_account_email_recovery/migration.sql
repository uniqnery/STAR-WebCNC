ALTER TABLE "users" ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);
CREATE TABLE "account_challenges" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "token_hash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "user_id" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "account_challenges_token_hash_key" ON "account_challenges" ("token_hash");
CREATE INDEX "account_challenges_email_purpose_created_at_idx" ON "account_challenges" ("email", "purpose", "created_at");
CREATE TABLE "account_rate_limits" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL DEFAULT 0,
  "window_at" TIMESTAMP(3) NOT NULL,
  "last_at" TIMESTAMP(3) NOT NULL
);
