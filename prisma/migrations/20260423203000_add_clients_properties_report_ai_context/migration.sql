CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT,
    "addressText" TEXT NOT NULL,
    "parcelText" TEXT,
    "city" TEXT,
    "district" TEXT,
    "neighborhood" TEXT,
    "blockNo" TEXT,
    "parcelNo" TEXT,
    "planInfo" TEXT,
    "landArea" DOUBLE PRECISION,
    "landQuality" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Report" ADD COLUMN "clientId" TEXT;
ALTER TABLE "Report" ADD COLUMN "propertyId" TEXT;
ALTER TABLE "Report" ADD COLUMN "marketProjectionJson" JSONB;
ALTER TABLE "Report" ADD COLUMN "regionalStatsJson" JSONB;
ALTER TABLE "Report" ADD COLUMN "aiReviewJson" JSONB;

CREATE INDEX "Client_userId_idx" ON "Client"("userId");
CREATE INDEX "Client_fullName_idx" ON "Client"("fullName");
CREATE INDEX "Property_userId_idx" ON "Property"("userId");
CREATE INDEX "Property_clientId_idx" ON "Property"("clientId");
CREATE INDEX "Property_addressText_idx" ON "Property"("addressText");
CREATE INDEX "Report_userId_idx" ON "Report"("userId");
CREATE INDEX "Report_clientId_idx" ON "Report"("clientId");
CREATE INDEX "Report_propertyId_idx" ON "Report"("propertyId");

ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Property" ADD CONSTRAINT "Property_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Property" ADD CONSTRAINT "Property_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
