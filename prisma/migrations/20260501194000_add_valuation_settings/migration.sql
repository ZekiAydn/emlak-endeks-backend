CREATE TABLE "ValuationSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "constructionCostPerSqm" DOUBLE PRECISION DEFAULT 27000,
    "contractorSharePct" DOUBLE PRECISION DEFAULT 50,
    "annualInflationPct" DOUBLE PRECISION DEFAULT 30,
    "newBuildingAgeMax" INTEGER NOT NULL DEFAULT 5,
    "costFloorEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ValuationSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ValuationSettings" (
    "id",
    "constructionCostPerSqm",
    "contractorSharePct",
    "annualInflationPct",
    "newBuildingAgeMax",
    "costFloorEnabled",
    "updatedAt"
) VALUES (
    'default',
    27000,
    50,
    30,
    5,
    true,
    CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;
