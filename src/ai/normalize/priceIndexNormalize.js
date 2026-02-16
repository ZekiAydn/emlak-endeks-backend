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

function clampNum(v, min, max) {
    const n = toNumberOrNull(v);
    if (n === null) return null;
    return Math.max(min, Math.min(max, n));
}

function strOrNull(v, maxLen = 120) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s.slice(0, maxLen);
}

// comps sanitize: güvenli, sınırlı ve sayısal alanlar normalize
function normalizeComps(v) {
    const arr = Array.isArray(v) ? v : [];
    return arr.slice(0, 12).map((c) => ({
        title: strOrNull(c?.title, 90),
        price: toNumberOrNull(c?.price),
        netArea: toNumberOrNull(c?.netArea),
        grossArea: toNumberOrNull(c?.grossArea),
        floor: toNumberOrNull(c?.floor),
        buildingAge: toNumberOrNull(c?.buildingAge),
        distanceKm: toNumberOrNull(c?.distanceKm),
    }));
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

    // ✅ yeni alanlar (grafik ve rapor zenginleştirme)
    const expectedSaleDays = clampNum(json?.expectedSaleDays, 7, 365);
    const discountToSellFastPct = clampNum(json?.discountToSellFastPct, 0, 25); // 0..25%
    const priceSensitivity = clamp01(json?.priceSensitivity);

    const comps = normalizeComps(json?.comps);

    // Metinler
    const rationale = strOrNull(json?.rationale, 1200); // PDF’de taşma kontrolünü ayrıca yapacağız
    const assumptions = Array.isArray(json?.assumptions)
        ? json.assumptions.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20)
        : [];
    const missingData = Array.isArray(json?.missingData)
        ? json.missingData.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20)
        : [];

    return {
        minPrice,
        avgPrice,
        maxPrice,
        minPricePerSqm,
        avgPricePerSqm,
        maxPricePerSqm,

        expectedSaleDays,
        discountToSellFastPct,
        priceSensitivity,
        comps,

        confidence: clamp01(json?.confidence),
        rationale,
        assumptions,
        missingData,
    };
}

module.exports = { normalizePriceIndex };
