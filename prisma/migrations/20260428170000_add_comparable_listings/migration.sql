-- CreateTable
CREATE TABLE "ComparableListing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT,
    "description" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "city" TEXT,
    "district" TEXT,
    "neighborhood" TEXT,
    "addressText" TEXT,
    "grossM2" DOUBLE PRECISION,
    "netM2" DOUBLE PRECISION,
    "roomCount" INTEGER,
    "salonCount" INTEGER,
    "bathCount" INTEGER,
    "propertyType" TEXT,
    "buildingAge" INTEGER,
    "floor" INTEGER,
    "totalFloors" INTEGER,
    "heating" TEXT,
    "imageUrl" TEXT NOT NULL,
    "imageStatus" TEXT NOT NULL DEFAULT 'DEFAULT',
    "listingUrl" TEXT NOT NULL,
    "providerRaw" JSONB,
    "parsedRaw" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "missingFields" TEXT[] NOT NULL,
    "isManualVerified" BOOLEAN NOT NULL DEFAULT false,
    "isSelectedForReport" BOOLEAN NOT NULL DEFAULT false,
    "comparableGroup" TEXT,
    "pricePerSqm" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComparableListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComparableListing_userId_idx" ON "ComparableListing"("userId");

-- CreateIndex
CREATE INDEX "ComparableListing_reportId_idx" ON "ComparableListing"("reportId");

-- CreateIndex
CREATE INDEX "ComparableListing_source_idx" ON "ComparableListing"("source");

-- CreateIndex
CREATE INDEX "ComparableListing_city_district_neighborhood_idx" ON "ComparableListing"("city", "district", "neighborhood");

-- CreateIndex
CREATE INDEX "ComparableListing_listingUrl_idx" ON "ComparableListing"("listingUrl");

-- AddForeignKey
ALTER TABLE "ComparableListing" ADD CONSTRAINT "ComparableListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparableListing" ADD CONSTRAINT "ComparableListing_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;
