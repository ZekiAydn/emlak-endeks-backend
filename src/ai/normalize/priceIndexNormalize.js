function toNumberOrNull(v) {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;

    const s0 = String(v).trim();
    if (!s0) return null;

    const s = s0
        .replace(/\./g, "")
        .replace(",", ".")
        .replace(/[^\d.]/g, "");

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

function clamp01(v) {
    const n = toNumberOrNull(v);
    if (n === null) return null;
    return Math.max(0, Math.min(1, n));
}

function normalizePriceIndex(json, areaHint /* netArea || grossArea */) {
    const minPrice = toNumberOrNull(json?.minPrice);
    const avgPrice = toNumberOrNull(json?.avgPrice);
    const maxPrice = toNumberOrNull(json?.maxPrice);

    let minPricePerSqm = toNumberOrNull(json?.minPricePerSqm);
    let avgPricePerSqm = toNumberOrNull(json?.avgPricePerSqm);
    let maxPricePerSqm = toNumberOrNull(json?.maxPricePerSqm);

    const area = toNumberOrNull(areaHint);
    if (area && area > 0) {
        if (minPrice !== null && minPricePerSqm === null) minPricePerSqm = minPrice / area;
        if (avgPrice !== null && avgPricePerSqm === null) avgPricePerSqm = avgPrice / area;
        if (maxPrice !== null && maxPricePerSqm === null) maxPricePerSqm = maxPrice / area;
    }

    return {
        minPrice,
        avgPrice,
        maxPrice,
        minPricePerSqm,
        avgPricePerSqm,
        maxPricePerSqm,
        confidence: clamp01(json?.confidence),
        rationale: json?.rationale ? String(json.rationale).trim().slice(0, 800) : null,
        assumptions: Array.isArray(json?.assumptions) ? json.assumptions.map(String).slice(0, 20) : [],
        missingData: Array.isArray(json?.missingData) ? json.missingData.map(String).slice(0, 20) : []
    };
}

module.exports = { normalizePriceIndex };
