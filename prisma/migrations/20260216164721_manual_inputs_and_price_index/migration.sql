
ALTER TABLE "BuildingDetails" DROP COLUMN "hasParking",
ADD COLUMN     "buildingCondition" TEXT,
ADD COLUMN     "closedParking" BOOLEAN,
ADD COLUMN     "closedPool" BOOLEAN,
ADD COLUMN     "hasAC" BOOLEAN,
ADD COLUMN     "hasCaretaker" BOOLEAN,
ADD COLUMN     "hasChildrenPark" BOOLEAN,
ADD COLUMN     "hasFireplace" BOOLEAN,
ADD COLUMN     "hasGenerator" BOOLEAN,
ADD COLUMN     "hasSportsArea" BOOLEAN,
ADD COLUMN     "hasThermalInsulation" BOOLEAN,
ADD COLUMN     "isOnMainRoad" BOOLEAN,
ADD COLUMN     "isOnStreet" BOOLEAN,
ADD COLUMN     "openParking" BOOLEAN,
ADD COLUMN     "openPool" BOOLEAN,
ADD COLUMN     "propertyType" TEXT;

-- AlterTable
ALTER TABLE "PricingAnalysis" ADD COLUMN     "aiJson" JSONB,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "expectedPricePerSqm" DOUBLE PRECISION,
ADD COLUMN     "maxPricePerSqm" DOUBLE PRECISION,
ADD COLUMN     "minPricePerSqm" DOUBLE PRECISION,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "PropertyDetails" DROP COLUMN "facade",
DROP COLUMN "view",
ADD COLUMN     "facadeDirections" JSONB,
ADD COLUMN     "terraceArea" DOUBLE PRECISION,
ADD COLUMN     "usageStatus" TEXT,
ADD COLUMN     "viewTags" JSONB;
