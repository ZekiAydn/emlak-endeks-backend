ALTER TABLE "User" ADD COLUMN "spkLicenseNo" TEXT;

ALTER TABLE "Report" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE "Report" ADD COLUMN "draftStep" INTEGER;
ALTER TABLE "Report" ADD COLUMN "draftData" JSONB;

CREATE INDEX "Report_userId_status_idx" ON "Report"("userId", "status");
