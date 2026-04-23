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
        source: strOrNull(c?.source, 90),
        sourceUrl: strOrNull(c?.sourceUrl, 220),
        price: toNumberOrNull(c?.price),
        netArea: toNumberOrNull(c?.netArea),
        grossArea: toNumberOrNull(c?.grossArea),
        floor: toNumberOrNull(c?.floor),
        totalFloors: toNumberOrNull(c?.totalFloors),
        buildingAge: toNumberOrNull(c?.buildingAge),
        distanceKm: toNumberOrNull(c?.distanceKm),
        distanceMeters: toNumberOrNull(c?.distanceMeters),
        listingAgeDays: toNumberOrNull(c?.listingAgeDays),
        roomText: strOrNull(c?.roomText, 20),
    }));
}

function normalizeMarketProjection(v) {
    if (!v || typeof v !== "object") return null;
    const out = {
        averageMarketingDays: toNumberOrNull(v.averageMarketingDays),
        competitionStatus: strOrNull(v.competitionStatus, 80),
        activeComparableCount: toNumberOrNull(v.activeComparableCount),
        waitingComparableCount: toNumberOrNull(v.waitingComparableCount),
        annualChangePct: toNumberOrNull(v.annualChangePct),
        totalReturnPct: toNumberOrNull(v.totalReturnPct),
        amortizationYears: toNumberOrNull(v.amortizationYears),
        summary: strOrNull(v.summary, 1000),
    };
    return Object.values(out).some((x) => x !== null) ? out : null;
}

function normalizeRegionalStats(v) {
    if (!v || typeof v !== "object") return null;
    const out = {
        demographicsSummary: strOrNull(v.demographicsSummary, 900),
        saleMarketSummary: strOrNull(v.saleMarketSummary, 900),
        rentalMarketSummary: strOrNull(v.rentalMarketSummary, 900),
        nearbyPlacesSummary: strOrNull(v.nearbyPlacesSummary, 900),
        riskSummary: strOrNull(v.riskSummary, 900),
    };
    return Object.values(out).some(Boolean) ? out : null;
}

function normalizePriceIndex(json, areaHint /* netArea || grossArea */) {
    let minPrice = toNumberOrNull(json?.minPrice);
    let avgPrice = toNumberOrNull(json?.avgPrice);
    let maxPrice = toNumberOrNull(json?.maxPrice);

    let minPricePerSqm = toNumberOrNull(json?.minPricePerSqm);
    let avgPricePerSqm = toNumberOrNull(json?.avgPricePerSqm);
    let maxPricePerSqm = toNumberOrNull(json?.maxPricePerSqm);

    const area = toNumberOrNull(areaHint);
    if (area && area > 0) {
        if (minPrice === null && minPricePerSqm !== null) minPrice = minPricePerSqm * area;
        if (avgPrice === null && avgPricePerSqm !== null) avgPrice = avgPricePerSqm * area;
        if (maxPrice === null && maxPricePerSqm !== null) maxPrice = maxPricePerSqm * area;

        if (avgPrice !== null && minPrice === null) minPrice = avgPrice * 0.88;
        if (avgPrice !== null && maxPrice === null) maxPrice = avgPrice * 1.12;
        if (avgPrice === null && minPrice !== null && maxPrice !== null) avgPrice = (minPrice + maxPrice) / 2;

        if (minPrice !== null && minPricePerSqm === null) minPricePerSqm = minPrice / area;
        if (avgPrice !== null && avgPricePerSqm === null) avgPricePerSqm = avgPrice / area;
        if (maxPrice !== null && maxPricePerSqm === null) maxPricePerSqm = maxPrice / area;
    }

    if (minPrice !== null && avgPrice !== null && minPrice > avgPrice) minPrice = avgPrice;
    if (maxPrice !== null && avgPrice !== null && maxPrice < avgPrice) maxPrice = avgPrice;
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
        const tmp = minPrice;
        minPrice = maxPrice;
        maxPrice = tmp;
    }

    if (minPricePerSqm !== null && avgPricePerSqm !== null && minPricePerSqm > avgPricePerSqm) minPricePerSqm = avgPricePerSqm;
    if (maxPricePerSqm !== null && avgPricePerSqm !== null && maxPricePerSqm < avgPricePerSqm) maxPricePerSqm = avgPricePerSqm;
    if (minPricePerSqm !== null && maxPricePerSqm !== null && minPricePerSqm > maxPricePerSqm) {
        const tmp = minPricePerSqm;
        minPricePerSqm = maxPricePerSqm;
        maxPricePerSqm = tmp;
    }

    const roundPrice = (v) => (v === null ? null : Math.round(v / 1000) * 1000);
    const roundSqm = (v) => (v === null ? null : Math.round(v));
    minPrice = roundPrice(minPrice);
    avgPrice = roundPrice(avgPrice);
    maxPrice = roundPrice(maxPrice);
    minPricePerSqm = roundSqm(minPricePerSqm);
    avgPricePerSqm = roundSqm(avgPricePerSqm);
    maxPricePerSqm = roundSqm(maxPricePerSqm);

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
        marketProjection: normalizeMarketProjection(json?.marketProjection),
        regionalStats: normalizeRegionalStats(json?.regionalStats),
    };
}

module.exports = { normalizePriceIndex };
