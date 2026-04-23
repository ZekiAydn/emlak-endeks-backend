ALTER TYPE "MediaType" ADD VALUE IF NOT EXISTS 'COMPS_LOW_SCREENSHOT';
ALTER TYPE "MediaType" ADD VALUE IF NOT EXISTS 'COMPS_MID_SCREENSHOT';
ALTER TYPE "MediaType" ADD VALUE IF NOT EXISTS 'COMPS_HIGH_SCREENSHOT';

ALTER TABLE "PricingAnalysis"
    ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(6),
    ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(6);

ALTER TABLE "PropertyDetails"
    ADD COLUMN "facade" TEXT,
    ADD COLUMN "view" TEXT;

CREATE OR REPLACE FUNCTION jsonb_to_text_array(value JSONB)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(array_agg(item), ARRAY[]::TEXT[])
    FROM jsonb_array_elements_text(
        CASE
            WHEN value IS NULL THEN '[]'::JSONB
            WHEN jsonb_typeof(value) = 'array' THEN value
            WHEN jsonb_typeof(value) = 'string' THEN jsonb_build_array(value #>> '{}')
            ELSE '[]'::JSONB
        END
    ) AS item;
$$;

ALTER TABLE "PropertyDetails"
    ALTER COLUMN "facadeDirections" TYPE TEXT[] USING jsonb_to_text_array("facadeDirections"),
    ALTER COLUMN "viewTags" TYPE TEXT[] USING jsonb_to_text_array("viewTags");

DROP FUNCTION jsonb_to_text_array(JSONB);
