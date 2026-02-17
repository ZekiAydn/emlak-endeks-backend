function pickDefined(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (v !== undefined) out[k] = v;
    }
    return out;
}

function normalizeTextArray(v) {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);

    // "Kuzey, Doğu" gibi gelirse
    if (typeof v === "string") {
        const arr = v.split(",").map((s) => s.trim()).filter(Boolean);
        return arr.length ? arr : [];
    }

    return undefined;
}

function sanitizePropertyDetails(pd) {
    if (!pd) return null;

    const facadeDirections = normalizeTextArray(pd.facadeDirections);
    const viewTags = normalizeTextArray(pd.viewTags);

    // PDF compat (eski alanlar): facade/view string kalsın istiyorsan doldur
    const facadeCompat =
        pd.facade !== undefined
            ? pd.facade
            : Array.isArray(facadeDirections)
                ? facadeDirections.join(", ")
                : undefined;

    const viewCompat =
        pd.view !== undefined
            ? pd.view
            : Array.isArray(viewTags)
                ? viewTags.join(", ")
                : undefined;

    return pickDefined({
        roomCount: pd.roomCount,
        salonCount: pd.salonCount,
        bathCount: pd.bathCount,
        grossArea: pd.grossArea,
        netArea: pd.netArea,
        floor: pd.floor,
        heating: pd.heating,

        // ✅ yeni alanlar (DB + Prisma’da olmalı)
        terraceArea: pd.terraceArea,
        usageStatus: pd.usageStatus,
        facadeDirections,
        viewTags,

        // ✅ eski alanlar (istersen tut)
        facade: facadeCompat,
        view: viewCompat,
    });
}

function sanitizeBuildingDetails(bd) {
    if (!bd) return null;

    return pickDefined({
        propertyType: bd.propertyType,
        buildingAge: bd.buildingAge,
        buildingFloors: bd.buildingFloors,
        buildingCondition: bd.buildingCondition,

        isOnMainRoad: bd.isOnMainRoad,
        isOnStreet: bd.isOnStreet,
        isSite: bd.isSite,
        hasElevator: bd.hasElevator,

        openParking: bd.openParking,
        closedParking: bd.closedParking,

        hasSportsArea: bd.hasSportsArea,
        hasCaretaker: bd.hasCaretaker,
        hasChildrenPark: bd.hasChildrenPark,
        security: bd.security,

        openPool: bd.openPool,
        closedPool: bd.closedPool,

        hasGenerator: bd.hasGenerator,
        hasThermalInsulation: bd.hasThermalInsulation,
        hasAC: bd.hasAC,
        hasFireplace: bd.hasFireplace,
    });
}

function sanitizePricingAnalysis(pa) {
    if (!pa) return null;

    return pickDefined({
        minPrice: pa.minPrice,
        expectedPrice: pa.expectedPrice,
        maxPrice: pa.maxPrice,
        note: pa.note,

        minPricePerSqm: pa.minPricePerSqm,
        expectedPricePerSqm: pa.expectedPricePerSqm,
        maxPricePerSqm: pa.maxPricePerSqm,
        confidence: pa.confidence,

        aiJson: pa.aiJson,
    });
}

function buildAiNote(n) {
    const parts = [];
    if (n?.rationale) parts.push(String(n.rationale));

    if (Array.isArray(n?.assumptions) && n.assumptions.length) {
        parts.push("\nVarsayımlar:\n- " + n.assumptions.map(String).join("\n- "));
    }

    // ✅ boşsa hiç basma
    if (Array.isArray(n?.missingData) && n.missingData.length) {
        parts.push("\nEksik Veri:\n- " + n.missingData.map(String).join("\n- "));
    }

    return parts.filter(Boolean).join("\n");
}


module.exports = {
    pickDefined,
    normalizeTextArray,
    sanitizePropertyDetails,
    sanitizeBuildingDetails,
    sanitizePricingAnalysis,
    buildAiNote,
};
