-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('USER_PHOTO', 'CERTIFICATE', 'REPORT_COVER', 'MAP_IMAGE', 'COMPS_SCREENSHOT', 'CHARTS_SCREENSHOT', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "about" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "clientFullName" TEXT NOT NULL,
    "addressText" TEXT NOT NULL,
    "parcelText" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "consultantOpinion" TEXT,
    "comparablesJson" JSONB,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyDetails" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "roomCount" INTEGER,
    "salonCount" INTEGER,
    "bathCount" INTEGER,
    "grossArea" DOUBLE PRECISION,
    "netArea" DOUBLE PRECISION,
    "floor" INTEGER,
    "heating" TEXT,
    "facade" TEXT,
    "view" TEXT,

    CONSTRAINT "PropertyDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildingDetails" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "buildingAge" INTEGER,
    "buildingFloors" INTEGER,
    "hasElevator" BOOLEAN,
    "hasParking" BOOLEAN,
    "isSite" BOOLEAN,
    "security" BOOLEAN,

    CONSTRAINT "BuildingDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingAnalysis" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "minPrice" DOUBLE PRECISION,
    "expectedPrice" DOUBLE PRECISION,
    "maxPrice" DOUBLE PRECISION,
    "note" TEXT,

    CONSTRAINT "PricingAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "MediaType" NOT NULL,
    "mime" TEXT NOT NULL,
    "filename" TEXT,
    "data" BYTEA NOT NULL,
    "userId" TEXT,
    "reportId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyDetails_reportId_key" ON "PropertyDetails"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "BuildingDetails_reportId_key" ON "BuildingDetails"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingAnalysis_reportId_key" ON "PricingAnalysis"("reportId");

-- CreateIndex
CREATE INDEX "Media_userId_idx" ON "Media"("userId");

-- CreateIndex
CREATE INDEX "Media_reportId_idx" ON "Media"("reportId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyDetails" ADD CONSTRAINT "PropertyDetails_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingDetails" ADD CONSTRAINT "BuildingDetails_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingAnalysis" ADD CONSTRAINT "PricingAnalysis_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;
