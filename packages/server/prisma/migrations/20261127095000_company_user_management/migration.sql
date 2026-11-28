ALTER TABLE "users" ADD COLUMN "is_representative" BOOLEAN NOT NULL DEFAULT false;
-- Each installation belongs to one company. Keep at most one representative.
CREATE UNIQUE INDEX "users_single_representative" ON "users" ("is_representative") WHERE "is_representative" = true;
ALTER TABLE "users" ADD CONSTRAINT "users_representative_admin" CHECK (NOT "is_representative" OR ("role" = 'ADMIN' AND "is_active" AND "is_approved"));
