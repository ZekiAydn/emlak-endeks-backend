import crypto from "node:crypto";
import prisma from "../prisma.js";
import { getDefaultComparableImage } from "../helpers/defaultComparableImage.js";
import { calculateComparableDataQuality, calculateComparableMatchScore, createComparableIngestionJob } from "./comparableIngestionService.js";

function cleanString(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function envNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function addHours(date, hours) {
    const next = new Date(date);
    next.setUTCHours(next.getUTCHours() + Number(hours || 0));
    return next;
}

function defaultComparableImage() {
    return getDefaultComparableImage();
}

function isDefaultImage(url) {
    return !cleanString(url) || cleanString(url) === defaultComparableImage();
}

function subjectAreaBucket(area) {
    const value = Number(area);
    if (!Number.isFinite(value) || value <= 0) return "unknown";
    const start = Math.floor(value / 20) * 20;
    return `${start}-${start + 20}`;
}

function comparableCacheKey(input = {}) {
    const raw = [
        input.city,
        input.district,
        input.neighborhood,
        input.compoundName,
        input.propertyType,
        input.roomText,
        subjectAreaBucket(input.subjectArea),
        input.reportType,
    ].map((value) => cleanString(value).toLocaleLowerCase("tr-TR")).join("|");
    return crypto.createHash("sha1").update(raw).digest("hex");
}

function usableArea(item = {}) {
    return numberOrNull(item.grossAreaM2) > 0
        ? numberOrNull(item.grossAreaM2)
        : numberOrNull(item.grossM2) > 0
            ? numberOrNull(item.grossM2)
            : numberOrNull(item.netAreaM2) > 0
                ? numberOrNull(item.netAreaM2)
                : numberOrNull(item.netM2) > 0
                    ? numberOrNull(item.netM2)
                    : null;
}

function unitPrice(item = {}) {
    const direct = numberOrNull(item.pricePerM2) || numberOrNull(item.pricePerSqm);
    if (direct && direct > 0) return direct;
    const price = numberOrNull(item.price);
    const area = usableArea(item);
    return price && area ? Math.round((price / area) * 100) / 100 : null;
}

function quantile(values = [], ratio) {
    const list = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!list.length) return null;
    const pos = (list.length - 1) * ratio;
    const lower = Math.floor(pos);
    const upper = Math.ceil(pos);
    if (lower === upper) return list[lower];
    return list[lower] * (1 - (pos - lower)) + list[upper] * (pos - lower);
}

function removeOutliers(candidates = []) {
    const priced = candidates.filter((item) => Number.isFinite(numberOrNull(item.pricePerM2)));
    if (priced.length < 8) return candidates;

    const values = priced.map((item) => numberOrNull(item.pricePerM2));
    const q1 = quantile(values, 0.25);
    const q3 = quantile(values, 0.75);
    if (!Number.isFinite(q1) || !Number.isFinite(q3)) return candidates;
    const iqr = q3 - q1;
    const min = q1 - iqr * 1.5;
    const max = q3 + iqr * 1.5;
    return candidates.filter((item) => {
        const value = numberOrNull(item.pricePerM2);
        return !Number.isFinite(value) || (value >= min && value <= max);
    });
}

function areaDiff(item, input = {}) {
    const subject = numberOrNull(input.subjectArea);
    const area = usableArea(item);
    if (!subject || !area) return Number.MAX_SAFE_INTEGER;
    return Math.abs(area - subject);
}

function responseKey(item, index = 0) {
    return item.id || item.sourceUrl || item.listingUrl || `${item.title || "comparable"}:${index}`;
}

export function normalizeComparableResponse(record = {}, group = null, input = {}) {
    const grossAreaM2 = numberOrNull(record.grossAreaM2) ?? numberOrNull(record.grossM2);
    const netAreaM2 = numberOrNull(record.netAreaM2) ?? numberOrNull(record.netM2);
    const pricePerM2 = numberOrNull(record.pricePerM2) ?? numberOrNull(record.pricePerSqm) ?? unitPrice({ ...record, grossAreaM2, netAreaM2 });
    const imageUrl = cleanString(record.imageUrl) || defaultComparableImage();
    const sourceUrl = cleanString(record.sourceUrl || record.listingUrl);

    return {
        id: record.id || null,
        title: record.title || null,
        description: record.description || null,
        price: numberOrNull(record.price),
        currency: record.currency || "TRY",
        pricePerM2,
        pricePerSqm: pricePerM2,
        grossAreaM2,
        netAreaM2,
        grossArea: grossAreaM2,
        netArea: netAreaM2,
        grossM2: grossAreaM2,
        netM2: netAreaM2,
        roomText: record.roomText || input.roomText || null,
        roomCount: record.roomCount ?? null,
        salonCount: record.salonCount ?? null,
        city: record.city || input.city || null,
        district: record.district || input.district || null,
        neighborhood: record.neighborhood || input.neighborhood || null,
        compoundName: record.compoundName || input.compoundName || null,
        propertyType: record.propertyType || input.propertyType || null,
        source: record.source || "UNKNOWN",
        sourceUrl,
        listingUrl: sourceUrl,
        imageUrl,
        imageSource: isDefaultImage(imageUrl) ? "DEFAULT" : record.imageSource || "UNKNOWN",
        imageStatus: isDefaultImage(imageUrl) ? "DEFAULT" : "REAL",
        buildingAge: record.buildingAgeText ?? record.buildingAge ?? null,
        floor: record.floorText ?? record.floor ?? null,
        totalFloors: record.totalFloorsText ?? record.totalFloors ?? null,
        heatingType: record.heatingType || record.heating || null,
        dataQuality: numberOrNull(record.dataQuality) ?? 0,
        matchScore: numberOrNull(record.matchScore) ?? 0,
        matchLevel: record.matchLevel || "UNKNOWN",
        freshnessStatus: record.freshnessStatus || "FRESH",
        firstSeenAt: record.firstSeenAt || null,
        lastSeenAt: record.lastSeenAt || null,
        staleAfter: record.staleAfter || null,
        expiresAt: record.expiresAt || null,
        group,
        comparableGroup: group ? group.toUpperCase() : record.comparableGroup || null,
    };
}

function placeholderComparable(input = {}) {
    return {
        title: "Emsal görseli bulunamadı",
        description: null,
        price: null,
        currency: "TRY",
        pricePerM2: null,
        pricePerSqm: null,
        grossAreaM2: null,
        netAreaM2: null,
        grossArea: null,
        netArea: null,
        grossM2: null,
        netM2: null,
        roomText: input.roomText || null,
        city: input.city || null,
        district: input.district || null,
        neighborhood: input.neighborhood || null,
        compoundName: input.compoundName || null,
        propertyType: input.propertyType || null,
        source: "DEFAULT_PLACEHOLDER",
        sourceUrl: null,
        listingUrl: null,
        imageUrl: defaultComparableImage(),
        imageSource: "DEFAULT",
        imageStatus: "DEFAULT",
        buildingAge: null,
        floor: null,
        totalFloors: null,
        heatingType: null,
        dataQuality: 0,
        matchScore: 0,
        matchLevel: "UNKNOWN",
        freshnessStatus: "FRESH",
        firstSeenAt: null,
        lastSeenAt: null,
        staleAfter: null,
        expiresAt: null,
        group: null,
        comparableGroup: null,
    };
}

function makeWhere(input = {}) {
    const city = cleanString(input.city);
    const district = cleanString(input.district);
    const neighborhood = cleanString(input.neighborhood);
    const propertyType = cleanString(input.propertyType);
    const roomText = cleanString(input.roomText);
    const or = [];

    if (city && district && neighborhood) {
        or.push({
            city: { equals: city, mode: "insensitive" },
            district: { equals: district, mode: "insensitive" },
            neighborhood: { equals: neighborhood, mode: "insensitive" },
            ...(propertyType ? { propertyType: { equals: propertyType, mode: "insensitive" } } : {}),
            ...(roomText ? { roomText } : {}),
        });
        or.push({
            city: { equals: city, mode: "insensitive" },
            district: { equals: district, mode: "insensitive" },
            neighborhood: { equals: neighborhood, mode: "insensitive" },
        });
    }

    if (city && district) {
        or.push({
            city: { equals: city, mode: "insensitive" },
            district: { equals: district, mode: "insensitive" },
            ...(propertyType ? { propertyType: { equals: propertyType, mode: "insensitive" } } : {}),
            ...(roomText ? { roomText } : {}),
        });
        or.push({
            city: { equals: city, mode: "insensitive" },
            district: { equals: district, mode: "insensitive" },
        });
    }

    if (city) {
        or.push({
            city: { equals: city, mode: "insensitive" },
            ...(propertyType ? { propertyType: { equals: propertyType, mode: "insensitive" } } : {}),
        });
        or.push({ city: { equals: city, mode: "insensitive" } });
    }

    return {
        isActive: true,
        freshnessStatus: { not: "EXPIRED" },
        ...(or.length ? { OR: or } : {}),
    };
}

function targetCounts(availableCount) {
    const configured = {
        low: envNumber("COMPARABLE_REPORT_LOW_COUNT", 6),
        mid: envNumber("COMPARABLE_REPORT_MID_COUNT", 6),
        high: envNumber("COMPARABLE_REPORT_HIGH_COUNT", 6),
    };
    const target = envNumber("COMPARABLE_TARGET_REPORT_COUNT", configured.low + configured.mid + configured.high);
    if (availableCount >= target) return configured;
    if (availableCount <= 0) return { low: 0, mid: 0, high: 0 };

    const desiredTotal = availableCount >= envNumber("COMPARABLE_MIN_REPORT_COUNT", 9)
        ? availableCount
        : availableCount;
    const base = Math.floor(desiredTotal / 3);
    const remainder = desiredTotal % 3;
    return {
        low: base + (remainder > 0 ? 1 : 0),
        mid: base + (remainder > 1 ? 1 : 0),
        high: base,
    };
}

function bandCandidates(items = []) {
    const priced = items
        .filter((item) => Number.isFinite(numberOrNull(item.pricePerM2)))
        .sort((a, b) => numberOrNull(a.pricePerM2) - numberOrNull(b.pricePerM2));
    const unpriced = items.filter((item) => !Number.isFinite(numberOrNull(item.pricePerM2)));
    const total = priced.length;

    const withBands = priced.map((item, index) => {
        const ratio = total ? index / total : 0;
        const band = ratio < 1 / 3 ? "low" : ratio < 2 / 3 ? "mid" : "high";
        return { ...item, band };
    });

    return {
        low: withBands.filter((item) => item.band === "low"),
        mid: withBands.filter((item) => item.band === "mid"),
        high: withBands.filter((item) => item.band === "high"),
        unpriced,
    };
}

function sortForSelection(input = {}) {
    return (a, b) => {
        const scoreDelta = numberOrNull(b.matchScore) - numberOrNull(a.matchScore);
        if (scoreDelta) return scoreDelta;
        if (isDefaultImage(a.imageUrl) !== isDefaultImage(b.imageUrl)) return isDefaultImage(a.imageUrl) ? 1 : -1;
        const qualityDelta = numberOrNull(b.dataQuality) - numberOrNull(a.dataQuality);
        if (qualityDelta) return qualityDelta;
        const areaDelta = areaDiff(a, input) - areaDiff(b, input);
        if (areaDelta) return areaDelta;
        if (a.freshnessStatus !== b.freshnessStatus) return a.freshnessStatus === "FRESH" ? -1 : 1;
        return new Date(b.lastSeenAt || b.updatedAt || 0).getTime() - new Date(a.lastSeenAt || a.updatedAt || 0).getTime();
    };
}

function pickBands(candidates = [], input = {}) {
    const bands = bandCandidates(candidates);
    const counts = targetCounts(candidates.length);
    const selected = [];
    const selectedIds = new Set();
    const pick = (band, count) => {
        const rows = bands[band].slice().sort(sortForSelection(input));
        for (const row of rows) {
            if (selected.length >= envNumber("COMPARABLE_TARGET_REPORT_COUNT", 18)) break;
            if (selectedIds.has(row.id)) continue;
            if (selected.filter((item) => item.group === band).length >= count) break;
            selected.push({ ...row, group: band });
            selectedIds.add(row.id);
        }
    };

    pick("low", counts.low);
    pick("mid", counts.mid);
    pick("high", counts.high);

    const targetTotal = Math.min(candidates.length, envNumber("COMPARABLE_TARGET_REPORT_COUNT", 18));
    const remainder = [...candidates]
        .filter((item) => !selectedIds.has(item.id))
        .sort(sortForSelection(input));

    for (const row of remainder) {
        if (selected.length >= targetTotal) break;
        const smallestBand = ["low", "mid", "high"].sort((a, b) =>
            selected.filter((item) => item.group === a).length - selected.filter((item) => item.group === b).length
        )[0];
        selected.push({ ...row, group: row.band || smallestBand });
        selectedIds.add(row.id);
    }

    return selected;
}

function summarize(values = []) {
    const valid = values.map(Number).filter(Number.isFinite);
    if (!valid.length) return null;
    return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 100) / 100;
}

function groupSummary(comparables = []) {
    return {
        low: comparables.filter((item) => item.group === "low").length,
        mid: comparables.filter((item) => item.group === "mid").length,
        high: comparables.filter((item) => item.group === "high").length,
    };
}

function matchLevelSummary(comparables = []) {
    return comparables.reduce((acc, item) => {
        const key = item.matchLevel || "UNKNOWN";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function buildSelectionResult({ input, candidateCount, selected, cacheHit = false, comparableSource = "DB" }) {
    const normalized = selected.map((item) => normalizeComparableResponse(item, item.group, input));
    const freshCount = normalized.filter((item) => item.freshnessStatus === "FRESH").length;
    const staleCount = normalized.filter((item) => item.freshnessStatus === "STALE").length;
    const imageCount = normalized.filter((item) => !isDefaultImage(item.imageUrl)).length;
    const minCount = envNumber("COMPARABLE_MIN_REPORT_COUNT", 9);
    const status = normalized.length >= envNumber("COMPARABLE_TARGET_REPORT_COUNT", 18)
        ? "READY"
        : normalized.length > 0
            ? "PARTIAL"
            : "EMPTY";

    return {
        comparableStatus: status,
        comparableSource,
        comparableCount: normalized.length,
        candidateCount,
        freshCount,
        staleCount,
        imageCount,
        bandSummary: groupSummary(normalized),
        matchLevelSummary: matchLevelSummary(normalized),
        cacheHit,
        minReportCount: minCount,
        comparables: normalized,
    };
}

function cacheIsUsable(cache) {
    if (!cache?.resultsJson) return false;
    const now = Date.now();
    const comparables = Array.isArray(cache.resultsJson.comparables) ? cache.resultsJson.comparables : [];
    return comparables.every((item) => {
        if (item.freshnessStatus === "EXPIRED") return false;
        if (!item.expiresAt) return true;
        return new Date(item.expiresAt).getTime() > now;
    });
}

async function cacheResult(input, result) {
    const ttl = envNumber("COMPARABLE_CACHE_TTL_HOURS", 24);
    const key = comparableCacheKey(input);
    await prisma.comparableSearchCache.upsert({
        where: { cacheKey: key },
        create: {
            cacheKey: key,
            city: input.city || null,
            district: input.district || null,
            neighborhood: input.neighborhood || null,
            compoundName: input.compoundName || null,
            propertyType: input.propertyType || null,
            roomText: input.roomText || null,
            reportType: input.reportType || null,
            subjectArea: Number(input.subjectArea) || null,
            resultsJson: result,
            source: result.comparableSource || "DB",
            expiresAt: addHours(new Date(), ttl),
        },
        update: {
            resultsJson: result,
            source: result.comparableSource || "DB",
            expiresAt: addHours(new Date(), ttl),
        },
    });
}

export async function selectComparablesForReport(input = {}) {
    const startedAt = Date.now();
    const key = comparableCacheKey(input);
    const cache = await prisma.comparableSearchCache.findUnique({ where: { cacheKey: key } });

    if (cache && cache.expiresAt > new Date() && cacheIsUsable(cache)) {
        console.log("[COMPARABLES] cache hit", { cacheKey: key });
        return {
            ...cache.resultsJson,
            comparableSource: "CACHE",
            cacheHit: true,
        };
    }

    console.log("[COMPARABLES] cache miss", { cacheKey: key });
    const maxPool = envNumber("COMPARABLE_DISCOVERY_TARGET_RESULTS", 300);
    const records = await prisma.comparableListing.findMany({
        where: makeWhere(input),
        orderBy: [
            { freshnessStatus: "asc" },
            { dataQuality: "desc" },
            { matchScore: "desc" },
            { lastSeenAt: "desc" },
        ],
        take: maxPool,
    });
    console.log("[SELECT] candidates found", { count: records.length, city: input.city, district: input.district });

    const minQuality = envNumber("COMPARABLE_MIN_DATA_QUALITY", 50);
    const enriched = records
        .map((record) => {
            const dataQuality = Math.max(Number(record.dataQuality || 0), calculateComparableDataQuality(record));
            const match = calculateComparableMatchScore({ ...record, dataQuality }, input);
            const freshnessPenalty = record.freshnessStatus === "STALE" ? 15 : 0;
            return {
                ...record,
                dataQuality,
                matchScore: Math.max(0, match.matchScore - freshnessPenalty),
                matchLevel: match.matchLevel,
                pricePerM2: unitPrice(record),
            };
        })
        .filter((item) => item.freshnessStatus !== "EXPIRED");

    const qualityPreferred = enriched.filter((item) => Number(item.dataQuality) >= minQuality);
    const candidateSet = qualityPreferred.length >= envNumber("COMPARABLE_MIN_REPORT_COUNT", 9)
        ? qualityPreferred
        : enriched.map((item) => ({
            ...item,
            matchScore: Number(item.dataQuality) >= minQuality ? item.matchScore : Math.max(0, Number(item.matchScore || 0) - 20),
        }));

    const outlierCleaned = removeOutliers(candidateSet);
    const selected = pickBands(outlierCleaned, input);

    let result = buildSelectionResult({
        input,
        candidateCount: records.length,
        selected,
        cacheHit: false,
        comparableSource: "DB",
    });

    if (!result.comparables.length) {
        result = {
            ...buildSelectionResult({
                input,
                candidateCount: records.length,
                selected: [],
                cacheHit: false,
                comparableSource: "DEFAULT_PLACEHOLDER",
            }),
            comparables: [placeholderComparable(input)],
        };
    }

    if (result.comparableStatus === "READY") {
        await cacheResult(input, result);
    }
    console.log("[SELECT] selected low/mid/high", result.bandSummary);
    console.log("[COMPARABLES] request completed in X ms", { elapsedMs: Date.now() - startedAt });
    return result;
}

export async function createIngestionJobIfComparablePoolLow(input = {}, selection = {}) {
    const target = envNumber("COMPARABLE_TARGET_REPORT_COUNT", 18);
    const candidateTarget = envNumber("COMPARABLE_DISCOVERY_TARGET_URLS", 150);
    if (Number(selection.comparableCount || 0) >= target && Number(selection.candidateCount || 0) >= Math.min(60, candidateTarget)) {
        return null;
    }
    if (!cleanString(input.city) || !cleanString(input.district)) return null;
    return await createComparableIngestionJob({
        ...input,
        reason: "LOW_COMPARABLE_POOL",
        comparableCount: selection.comparableCount || 0,
        candidateCount: selection.candidateCount || 0,
    });
}

function buildPriceBand(comparables = [], subjectArea = null) {
    const area = numberOrNull(subjectArea);
    const unitPrices = comparables.map((item) => numberOrNull(item.pricePerM2)).filter(Number.isFinite);
    const prices = comparables.map((item) => numberOrNull(item.price)).filter(Number.isFinite);
    if (area && unitPrices.length >= 3) {
        const minPricePerSqm = Math.round(quantile(unitPrices, 0.2));
        const expectedPricePerSqm = Math.round(quantile(unitPrices, 0.5));
        const maxPricePerSqm = Math.round(quantile(unitPrices, 0.8));
        return {
            minPricePerSqm,
            expectedPricePerSqm,
            maxPricePerSqm,
            minPrice: Math.round(minPricePerSqm * area),
            expectedPrice: Math.round(expectedPricePerSqm * area),
            maxPrice: Math.round(maxPricePerSqm * area),
            confidence: Math.min(0.72, 0.42 + unitPrices.length * 0.012),
            note: `${comparables.length} normalize emsal üzerinden hesaplanan fiyat bandıdır.`,
        };
    }
    if (prices.length < 3) return null;
    return {
        minPrice: Math.round(quantile(prices, 0.2)),
        expectedPrice: Math.round(quantile(prices, 0.5)),
        maxPrice: Math.round(quantile(prices, 0.8)),
        minPricePerSqm: area ? Math.round(quantile(prices, 0.2) / area) : null,
        expectedPricePerSqm: area ? Math.round(quantile(prices, 0.5) / area) : null,
        maxPricePerSqm: area ? Math.round(quantile(prices, 0.8) / area) : null,
        confidence: Math.min(0.62, 0.36 + prices.length * 0.01),
        note: `${comparables.length} normalize emsal fiyat dağılımı üzerinden hesaplanan fiyat bandıdır.`,
    };
}

function buildMarketProjection(comparables = []) {
    return {
        averageMarketingDays: null,
        competitionStatus: comparables.length >= 12 ? "Orta" : "Düşük",
        activeComparableCount: comparables.length,
        waitingComparableCount: comparables.filter((item) => item.freshnessStatus === "STALE").length,
        annualChangePct: null,
        amortizationYears: null,
        summary: `${comparables.length} normalize DB emsali kullanıldı.`,
        manualText: `${comparables.length} normalize DB emsali kullanıldı.`,
    };
}

export function buildComparableBundleFromDbSelection(selection = {}, input = {}) {
    const comparables = Array.isArray(selection.comparables) ? selection.comparables : [];
    const minImageTarget = envNumber("COMPARABLE_MIN_IMAGE_TARGET", 12);
    const groups = {
        low: comparables.filter((item) => item.group === "low").map(responseKey),
        mid: comparables.filter((item) => item.group === "mid").map(responseKey),
        high: comparables.filter((item) => item.group === "high").map(responseKey),
    };
    const warnings = [];
    if (selection.comparableStatus === "PARTIAL") {
        warnings.push(`Hedeflenen ${envNumber("COMPARABLE_TARGET_REPORT_COUNT", 18)} emsal yerine ${selection.comparableCount} emsal kullanılmıştır.`);
    }
    if (Number(selection.imageCount || 0) < Math.min(minImageTarget, comparables.length)) {
        warnings.push(`Seçilen emsallerde gerçek fotoğraf sayısı hedefin altında kaldı (${selection.imageCount || 0}/${minImageTarget}); eksiklerde varsayılan görsel kullanıldı.`);
    }

    return {
        comparables,
        groups,
        marketProjection: comparables.length ? buildMarketProjection(comparables) : null,
        regionalStats: null,
        priceBand: comparables.length ? buildPriceBand(comparables, input.subjectArea) : null,
        warnings,
        sourceMeta: {
            provider: selection.comparableSource || "DB",
            fetchedAt: new Date().toISOString(),
            recordCount: selection.candidateCount || 0,
            sampleCount: selection.comparableCount || 0,
            comparableStatus: selection.comparableStatus,
            candidateCount: selection.candidateCount || 0,
            freshCount: selection.freshCount || 0,
            staleCount: selection.staleCount || 0,
            imageCount: selection.imageCount || 0,
            imageTarget: minImageTarget,
            bandSummary: selection.bandSummary || {},
            matchLevelSummary: selection.matchLevelSummary || {},
            cacheHit: Boolean(selection.cacheHit),
        },
    };
}
