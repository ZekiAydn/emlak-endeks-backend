import prisma from "../prisma.js";

const DEFAULT_VALUATION_SETTINGS = {
    id: "default",
    constructionCostPerSqm: 27000,
    contractorSharePct: 50,
    annualInflationPct: 30,
    newBuildingAgeMax: 5,
    costFloorEnabled: true,
};

function numberOrDefault(value, fallback, { min = null, max = null } = {}) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    let next = parsed;
    if (min !== null) next = Math.max(min, next);
    if (max !== null) next = Math.min(max, next);
    return next;
}

function boolOrDefault(value, fallback) {
    if (value === undefined || value === null) return fallback;
    return Boolean(value);
}

function normalizeValuationSettings(input = {}) {
    return {
        id: "default",
        constructionCostPerSqm: numberOrDefault(
            input.constructionCostPerSqm,
            DEFAULT_VALUATION_SETTINGS.constructionCostPerSqm,
            { min: 0, max: 500000 }
        ),
        contractorSharePct: numberOrDefault(
            input.contractorSharePct,
            DEFAULT_VALUATION_SETTINGS.contractorSharePct,
            { min: 1, max: 100 }
        ),
        annualInflationPct: numberOrDefault(
            input.annualInflationPct,
            DEFAULT_VALUATION_SETTINGS.annualInflationPct,
            { min: 0, max: 150 }
        ),
        newBuildingAgeMax: Math.round(numberOrDefault(
            input.newBuildingAgeMax,
            DEFAULT_VALUATION_SETTINGS.newBuildingAgeMax,
            { min: 0, max: 15 }
        )),
        costFloorEnabled: boolOrDefault(input.costFloorEnabled, DEFAULT_VALUATION_SETTINGS.costFloorEnabled),
    };
}

async function getValuationSettings() {
    const existing = await prisma.valuationSettings.findUnique({
        where: { id: "default" },
    });

    if (existing) return normalizeValuationSettings(existing);

    return prisma.valuationSettings.create({
        data: normalizeValuationSettings(DEFAULT_VALUATION_SETTINGS),
    });
}

async function updateValuationSettings(input = {}) {
    const data = normalizeValuationSettings(input);

    return prisma.valuationSettings.upsert({
        where: { id: "default" },
        create: data,
        update: {
            constructionCostPerSqm: data.constructionCostPerSqm,
            contractorSharePct: data.contractorSharePct,
            annualInflationPct: data.annualInflationPct,
            newBuildingAgeMax: data.newBuildingAgeMax,
            costFloorEnabled: data.costFloorEnabled,
        },
    });
}

export {
    DEFAULT_VALUATION_SETTINGS,
    getValuationSettings,
    normalizeValuationSettings,
    updateValuationSettings,
};
