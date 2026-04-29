CREATE TABLE "OpenLocationStat" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceDataset" TEXT NOT NULL,
    "sourceReliability" TEXT,
    "sourceKey" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "declaredSource" TEXT,
    "locationLevel" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'TR',
    "city" TEXT,
    "district" TEXT,
    "neighborhood" TEXT,
    "normalizedCity" TEXT,
    "normalizedDistrict" TEXT,
    "normalizedNeighborhood" TEXT,
    "year" INTEGER NOT NULL DEFAULT 0,
    "metricKey" TEXT NOT NULL,
    "metricLabel" TEXT,
    "metricValue" DOUBLE PRECISION,
    "metricText" TEXT,
    "unit" TEXT,
    "rawJson" JSONB,
    "fetchedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenLocationStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpenLocationStat_source_sourceDataset_sourceKey_metricKey_year_key"
    ON "OpenLocationStat"("source", "sourceDataset", "sourceKey", "metricKey", "year");

CREATE INDEX "OpenLocationStat_source_idx" ON "OpenLocationStat"("source");
CREATE INDEX "OpenLocationStat_sourceDataset_idx" ON "OpenLocationStat"("sourceDataset");
CREATE INDEX "OpenLocationStat_locationLevel_idx" ON "OpenLocationStat"("locationLevel");
CREATE INDEX "OpenLocationStat_normalizedCity_normalizedDistrict_normalizedNeighborhood_idx"
    ON "OpenLocationStat"("normalizedCity", "normalizedDistrict", "normalizedNeighborhood");
CREATE INDEX "OpenLocationStat_metricKey_idx" ON "OpenLocationStat"("metricKey");
CREATE INDEX "OpenLocationStat_year_idx" ON "OpenLocationStat"("year");
