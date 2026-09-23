-- Daily mood check-in: bind every submission to a calendar day so each
-- member can only keep one record per template per day.

ALTER TABLE "checkins" ADD COLUMN "checkInDate" DATE;

-- Existing rows (if any) fall back to the day they were created.
UPDATE "checkins" SET "checkInDate" = DATE("createdAt") WHERE "checkInDate" IS NULL;

ALTER TABLE "checkins" ALTER COLUMN "checkInDate" SET NOT NULL;

CREATE UNIQUE INDEX "checkins_templateId_memberId_checkInDate_key"
    ON "checkins"("templateId", "memberId", "checkInDate");

CREATE INDEX "checkins_memberId_checkInDate_idx"
    ON "checkins"("memberId", "checkInDate");
