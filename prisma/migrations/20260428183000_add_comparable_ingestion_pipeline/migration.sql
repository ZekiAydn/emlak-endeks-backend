-- Additive comparable ingestion pipeline schema.
-- This migration intentionally does not drop/reset existing comparable data.

CREATE TYPE "ComparableSourceStatus" AS ENUM (
    'DISCOVERED',
    'CANDIDATE',
    'FETCHED',
    'PARSED',
    'BLOCKED',
    'BLOCKED_WITH_SEARCH_DATA',
    'DUPLICATE',
    'FAILED',
    'REJECTED',
    'SKIPPED'
);

CREATE TYPE "ComparableFreshnessStatus" AS ENUM (
    'FRESH',
    'STALE',
    'EXPIRED'
);

CREATE TYPE "ComparableImageSource" AS ENUM (
    'JSON_LD',
    'OG_IMAGE',
    'TWITTER_IMAGE',
    'PAGE_GALLERY',
    'SEARCH_THUMBNAIL',
    'DUPLICATE_MERGE',
    'DEFAULT',
    'UNKNOWN'
);

CREATE TYPE "ComparableFieldSource" AS ENUM (
    'SEARCH_TITLE',
    'SEARCH_SNIPPET',
    'SEARCH_THUMBNAIL',
    'JSON_LD',
    'OG_META',
    'TWITTER_META',
    'HTML_VISIBLE_TEXT',
    'PAGE_GALLERY',
    'DUPLICATE_MERGE',
    'MANUAL',
    'DEFAULT',
    'UNKNOWN'
);

CREATE TYPE "ComparableMatchLevel" AS ENUM (
    'PROJECT_EXACT',
    'NEIGHBORHOOD_EXACT',
    'NEIGHBORHOOD_RELAXED',
    'DISTRICT_ROOM_AREA',
    'NEARBY_NEIGHBORHOOD',
    'DISTRICT_GENERAL',
    'CITY_GENERAL',
    'UNKNOWN'
);

CREATE TABLE "ComparableSearchResult" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "sourceEngine" TEXT,
    "resultRank" INTEGER,
    "title" TEXT,
    "snippet" TEXT,
    "url" TEXT NOT NULL,
    "displayUrl" TEXT,
    "thumbnailUrl" TEXT,
    "city" TEXT,
    "district" TEXT,
    "neighborhood" TEXT,
    "compoundName" TEXT,
    "propertyType" TEXT,
    "roomText" TEXT,
    "status" "ComparableSourceStatus" NOT NULL DEFAULT 'DISCOVERED',
    "rejectReason" TEXT,
    "extractedPrice" DOUBLE PRECISION,
    "extractedCurrency" TEXT,
    "extractedAreaM2" DOUBLE PRECISION,
    "extractedRoomText" TEXT,
    "extractedImageUrl" TEXT,
    "extractedDataJson" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComparableSearchResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComparableSourceUrl" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "query" TEXT,
    "searchResultId" TEXT,
    "city" TEXT,
    "district" TEXT,
    "neighborhood" TEXT,
    "compoundName" TEXT,
    "propertyType" TEXT,
    "roomText" TEXT,
    "status" "ComparableSourceStatus" NOT NULL DEFAULT 'DISCOVERED',
    "lastError" TEXT,
    "httpStatus" INTEGER,
    "blockedReason" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComparableSourceUrl_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComparableSearchCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "city" TEXT,
    "district" TEXT,
    "neighborhood" TEXT,
    "compoundName" TEXT,
    "propertyType" TEXT,
    "roomText" TEXT,
    "reportType" TEXT,
    "subjectArea" DOUBLE PRECISION,
    "resultsJson" JSONB NOT NULL,
    "source" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComparableSearchCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComparableIngestionJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "city" TEXT,
    "district" TEXT,
    "neighborhood" TEXT,
    "compoundName" TEXT,
    "propertyType" TEXT,
    "roomText" TEXT,
    "subjectArea" DOUBLE PRECISION,
    "payloadJson" JSONB,
    "resultJson" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComparableIngestionJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ComparableListing" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "ComparableListing"
    ADD COLUMN "sourceListingId" TEXT,
    ADD COLUMN "sourceUrl" TEXT,
    ADD COLUMN "alternateSourceUrls" JSONB,
    ADD COLUMN "pricePerM2" DOUBLE PRECISION,
    ADD COLUMN "compoundName" TEXT,
    ADD COLUMN "grossAreaM2" DOUBLE PRECISION,
    ADD COLUMN "netAreaM2" DOUBLE PRECISION,
    ADD COLUMN "roomText" TEXT,
    ADD COLUMN "buildingAgeText" TEXT,
    ADD COLUMN "floorText" TEXT,
    ADD COLUMN "totalFloorsText" TEXT,
    ADD COLUMN "heatingType" TEXT,
    ADD COLUMN "imageSource" "ComparableImageSource" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "imageFieldSource" "ComparableFieldSource" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "fallbackImageUrl" TEXT,
    ADD COLUMN "rawSearchResultJson" JSONB,
    ADD COLUMN "rawMetadataJson" JSONB,
    ADD COLUMN "rawExtractedJson" JSONB,
    ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "dataQuality" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "matchScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "matchLevel" "ComparableMatchLevel" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "priceSource" "ComparableFieldSource" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "areaSource" "ComparableFieldSource" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "roomSource" "ComparableFieldSource" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "titleSource" "ComparableFieldSource" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "freshnessStatus" "ComparableFreshnessStatus" NOT NULL DEFAULT 'FRESH',
    ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "staleAfter" TIMESTAMP(3),
    ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ComparableSearchResult_url_key" ON "ComparableSearchResult"("url");
CREATE INDEX "ComparableSearchResult_city_district_neighborhood_idx" ON "ComparableSearchResult"("city", "district", "neighborhood");
CREATE INDEX "ComparableSearchResult_status_idx" ON "ComparableSearchResult"("status");
CREATE INDEX "ComparableSearchResult_query_idx" ON "ComparableSearchResult"("query");
CREATE INDEX "ComparableSearchResult_propertyType_roomText_idx" ON "ComparableSearchResult"("propertyType", "roomText");

CREATE UNIQUE INDEX "ComparableSourceUrl_url_key" ON "ComparableSourceUrl"("url");
CREATE INDEX "ComparableSourceUrl_source_idx" ON "ComparableSourceUrl"("source");
CREATE INDEX "ComparableSourceUrl_status_idx" ON "ComparableSourceUrl"("status");
CREATE INDEX "ComparableSourceUrl_city_district_neighborhood_idx" ON "ComparableSourceUrl"("city", "district", "neighborhood");
CREATE INDEX "ComparableSourceUrl_propertyType_roomText_idx" ON "ComparableSourceUrl"("propertyType", "roomText");

CREATE UNIQUE INDEX "ComparableSearchCache_cacheKey_key" ON "ComparableSearchCache"("cacheKey");
CREATE INDEX "ComparableSearchCache_cacheKey_idx" ON "ComparableSearchCache"("cacheKey");
CREATE INDEX "ComparableSearchCache_city_district_neighborhood_idx" ON "ComparableSearchCache"("city", "district", "neighborhood");
CREATE INDEX "ComparableSearchCache_expiresAt_idx" ON "ComparableSearchCache"("expiresAt");

CREATE UNIQUE INDEX "ComparableListing_sourceUrl_key" ON "ComparableListing"("sourceUrl");
CREATE INDEX "ComparableListing_propertyType_roomText_idx" ON "ComparableListing"("propertyType", "roomText");
CREATE INDEX "ComparableListing_price_idx" ON "ComparableListing"("price");
CREATE INDEX "ComparableListing_pricePerM2_idx" ON "ComparableListing"("pricePerM2");
CREATE INDEX "ComparableListing_grossAreaM2_idx" ON "ComparableListing"("grossAreaM2");
CREATE INDEX "ComparableListing_dataQuality_idx" ON "ComparableListing"("dataQuality");
CREATE INDEX "ComparableListing_freshnessStatus_idx" ON "ComparableListing"("freshnessStatus");
CREATE INDEX "ComparableListing_lastSeenAt_idx" ON "ComparableListing"("lastSeenAt");
CREATE INDEX "ComparableListing_expiresAt_idx" ON "ComparableListing"("expiresAt");

ALTER TABLE "ComparableSourceUrl" ADD CONSTRAINT "ComparableSourceUrl_searchResultId_fkey"
    FOREIGN KEY ("searchResultId") REFERENCES "ComparableSearchResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;
