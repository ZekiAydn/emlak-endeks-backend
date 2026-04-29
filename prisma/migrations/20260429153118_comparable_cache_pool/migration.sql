DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ComparableSourceStatus') THEN
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
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ComparableFreshnessStatus') THEN
        CREATE TYPE "ComparableFreshnessStatus" AS ENUM ('FRESH', 'STALE', 'EXPIRED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ComparableImageSource') THEN
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
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ComparableFieldSource') THEN
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
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ComparableMatchLevel') THEN
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
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ComparableSearchResult" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComparableSearchResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ComparableSourceUrl" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComparableSourceUrl_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ComparableSearchCache" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComparableSearchCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ComparableIngestionJob" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComparableIngestionJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ComparableListing" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "reportId" TEXT,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "sourceListingId" TEXT,
    "sourceUrl" TEXT,
    "alternateSourceUrls" JSONB,
    "title" TEXT,
    "description" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "pricePerM2" DOUBLE PRECISION,
    "city" TEXT,
    "district" TEXT,
    "neighborhood" TEXT,
    "compoundName" TEXT,
    "addressText" TEXT,
    "reportType" TEXT,
    "valuationType" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "grossM2" DOUBLE PRECISION,
    "netM2" DOUBLE PRECISION,
    "grossAreaM2" DOUBLE PRECISION,
    "netAreaM2" DOUBLE PRECISION,
    "roomText" TEXT,
    "roomCount" INTEGER,
    "salonCount" INTEGER,
    "bathCount" INTEGER,
    "propertyType" TEXT,
    "buildingAge" INTEGER,
    "buildingAgeText" TEXT,
    "floor" INTEGER,
    "floorText" TEXT,
    "totalFloors" INTEGER,
    "totalFloorsText" TEXT,
    "heating" TEXT,
    "heatingType" TEXT,
    "imageUrl" TEXT NOT NULL,
    "imageStatus" TEXT NOT NULL DEFAULT 'DEFAULT',
    "imageSource" "ComparableImageSource" NOT NULL DEFAULT 'UNKNOWN',
    "imageFieldSource" "ComparableFieldSource" NOT NULL DEFAULT 'UNKNOWN',
    "fallbackImageUrl" TEXT,
    "listingUrl" TEXT NOT NULL,
    "providerRaw" JSONB,
    "parsedRaw" JSONB,
    "rawSearchResultJson" JSONB,
    "rawMetadataJson" JSONB,
    "rawExtractedJson" JSONB,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "missingFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isManualVerified" BOOLEAN NOT NULL DEFAULT false,
    "isSelectedForReport" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "comparableGroup" TEXT,
    "pricePerSqm" DOUBLE PRECISION,
    "dataQuality" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "matchScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "matchLevel" "ComparableMatchLevel" NOT NULL DEFAULT 'UNKNOWN',
    "priceSource" "ComparableFieldSource" NOT NULL DEFAULT 'UNKNOWN',
    "areaSource" "ComparableFieldSource" NOT NULL DEFAULT 'UNKNOWN',
    "roomSource" "ComparableFieldSource" NOT NULL DEFAULT 'UNKNOWN',
    "titleSource" "ComparableFieldSource" NOT NULL DEFAULT 'UNKNOWN',
    "freshnessStatus" "ComparableFreshnessStatus" NOT NULL DEFAULT 'FRESH',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staleAfter" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComparableListing_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ComparableListing" ADD COLUMN IF NOT EXISTS "reportType" TEXT;
ALTER TABLE "ComparableListing" ADD COLUMN IF NOT EXISTS "valuationType" TEXT;
ALTER TABLE "ComparableListing" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "ComparableListing" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;

CREATE UNIQUE INDEX IF NOT EXISTS "ComparableSearchResult_url_key" ON "ComparableSearchResult"("url");
CREATE INDEX IF NOT EXISTS "ComparableSearchResult_city_district_neighborhood_idx" ON "ComparableSearchResult"("city", "district", "neighborhood");
CREATE INDEX IF NOT EXISTS "ComparableSearchResult_status_idx" ON "ComparableSearchResult"("status");
CREATE INDEX IF NOT EXISTS "ComparableSearchResult_query_idx" ON "ComparableSearchResult"("query");
CREATE INDEX IF NOT EXISTS "ComparableSearchResult_propertyType_roomText_idx" ON "ComparableSearchResult"("propertyType", "roomText");

CREATE UNIQUE INDEX IF NOT EXISTS "ComparableSourceUrl_url_key" ON "ComparableSourceUrl"("url");
CREATE INDEX IF NOT EXISTS "ComparableSourceUrl_source_idx" ON "ComparableSourceUrl"("source");
CREATE INDEX IF NOT EXISTS "ComparableSourceUrl_status_idx" ON "ComparableSourceUrl"("status");
CREATE INDEX IF NOT EXISTS "ComparableSourceUrl_city_district_neighborhood_idx" ON "ComparableSourceUrl"("city", "district", "neighborhood");
CREATE INDEX IF NOT EXISTS "ComparableSourceUrl_propertyType_roomText_idx" ON "ComparableSourceUrl"("propertyType", "roomText");

CREATE UNIQUE INDEX IF NOT EXISTS "ComparableSearchCache_cacheKey_key" ON "ComparableSearchCache"("cacheKey");
CREATE INDEX IF NOT EXISTS "ComparableSearchCache_cacheKey_idx" ON "ComparableSearchCache"("cacheKey");
CREATE INDEX IF NOT EXISTS "ComparableSearchCache_city_district_neighborhood_idx" ON "ComparableSearchCache"("city", "district", "neighborhood");
CREATE INDEX IF NOT EXISTS "ComparableSearchCache_expiresAt_idx" ON "ComparableSearchCache"("expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ComparableListing_sourceUrl_key" ON "ComparableListing"("sourceUrl");
CREATE INDEX IF NOT EXISTS "ComparableListing_userId_idx" ON "ComparableListing"("userId");
CREATE INDEX IF NOT EXISTS "ComparableListing_reportId_idx" ON "ComparableListing"("reportId");
CREATE INDEX IF NOT EXISTS "ComparableListing_source_idx" ON "ComparableListing"("source");
CREATE INDEX IF NOT EXISTS "ComparableListing_city_district_neighborhood_idx" ON "ComparableListing"("city", "district", "neighborhood");
CREATE INDEX IF NOT EXISTS "ComparableListing_city_district_neighborhood_reportType_valuationType_idx" ON "ComparableListing"("city", "district", "neighborhood", "reportType", "valuationType");
CREATE INDEX IF NOT EXISTS "ComparableListing_reportType_valuationType_idx" ON "ComparableListing"("reportType", "valuationType");
CREATE INDEX IF NOT EXISTS "ComparableListing_propertyType_roomText_idx" ON "ComparableListing"("propertyType", "roomText");
CREATE INDEX IF NOT EXISTS "ComparableListing_latitude_longitude_idx" ON "ComparableListing"("latitude", "longitude");
CREATE INDEX IF NOT EXISTS "ComparableListing_price_idx" ON "ComparableListing"("price");
CREATE INDEX IF NOT EXISTS "ComparableListing_pricePerM2_idx" ON "ComparableListing"("pricePerM2");
CREATE INDEX IF NOT EXISTS "ComparableListing_grossAreaM2_idx" ON "ComparableListing"("grossAreaM2");
CREATE INDEX IF NOT EXISTS "ComparableListing_dataQuality_idx" ON "ComparableListing"("dataQuality");
CREATE INDEX IF NOT EXISTS "ComparableListing_freshnessStatus_idx" ON "ComparableListing"("freshnessStatus");
CREATE INDEX IF NOT EXISTS "ComparableListing_lastSeenAt_idx" ON "ComparableListing"("lastSeenAt");
CREATE INDEX IF NOT EXISTS "ComparableListing_expiresAt_idx" ON "ComparableListing"("expiresAt");
CREATE INDEX IF NOT EXISTS "ComparableListing_listingUrl_idx" ON "ComparableListing"("listingUrl");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ComparableSourceUrl_searchResultId_fkey') THEN
        ALTER TABLE "ComparableSourceUrl"
        ADD CONSTRAINT "ComparableSourceUrl_searchResultId_fkey"
        FOREIGN KEY ("searchResultId") REFERENCES "ComparableSearchResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ComparableListing_userId_fkey') THEN
        ALTER TABLE "ComparableListing"
        ADD CONSTRAINT "ComparableListing_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ComparableListing_reportId_fkey') THEN
        ALTER TABLE "ComparableListing"
        ADD CONSTRAINT "ComparableListing_reportId_fkey"
        FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
