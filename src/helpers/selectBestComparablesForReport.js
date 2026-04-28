import { dedupeComparableListings } from "./dedupeComparableListings.js";

const TARGET_TOTAL = 18;
const GROUP_TARGET = 6;
const KNOWN_SOURCES = new Set(["HEPSIEMLAK", "EMLAKJET", "REMAX", "SAHIBINDEN"]);

function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function normalizedText(value) {
    return String(value || "")
        .trim()
        .toLocaleLowerCase("tr-TR");
}

function usableArea(item) {
    return numberOrNull(item?.grossM2) > 0 ? numberOrNull(item.grossM2) : numberOrNull(item?.netM2) > 0 ? numberOrNull(item.netM2) : null;
}

function comparablePricePerSqm(item) {
    const price = numberOrNull(item?.price);
    const area = usableArea(item);
    return price && area ? Math.round((price / area) * 100) / 100 : null;
}

function hasLocation(item) {
    return Boolean(item?.addressText || item?.city || item?.district || item?.neighborhood);
}

function locationScore(item, target = {}) {
    let score = 0;
    if (target.city && normalizedText(item.city) === normalizedText(target.city)) score += 5;
    if (target.district && normalizedText(item.district) === normalizedText(target.district)) score += 5;
    if (target.neighborhood && normalizedText(item.neighborhood) === normalizedText(target.neighborhood)) score += 5;
    if (!score && hasLocation(item)) score += 5;
    return Math.min(15, score);
}

function roomScore(item, target = {}) {
    let score = 0;
    if (Number.isInteger(Number(target.roomCount)) && Number(item.roomCount) === Number(target.roomCount)) score += 6;
    if (Number.isInteger(Number(target.salonCount)) && Number(item.salonCount) === Number(target.salonCount)) score += 4;
    return Math.min(10, score);
}

function areaClosenessScore(item, target = {}) {
    const targetArea = numberOrNull(target.grossM2) || numberOrNull(target.netM2);
    const currentArea = usableArea(item);
    if (!targetArea || !currentArea) return 0;

    const diffRatio = Math.abs(currentArea - targetArea) / targetArea;
    if (diffRatio <= 0.05) return 10;
    if (diffRatio <= 0.1) return 8;
    if (diffRatio <= 0.2) return 6;
    if (diffRatio <= 0.35) return 3;
    return 0;
}

function areaDiff(item, target = {}) {
    const targetArea = numberOrNull(target.grossM2) || numberOrNull(target.netM2);
    const currentArea = usableArea(item);
    if (!targetArea || !currentArea) return Number.MAX_SAFE_INTEGER;
    return Math.abs(currentArea - targetArea);
}

function selectionScore(item, target = {}) {
    let score = 0;
    if (numberOrNull(item.price) > 0) score += 25;
    if (usableArea(item)) score += 25;
    score += item.imageStatus === "REAL" ? 20 : 5;
    score += locationScore(item, target);
    score += roomScore(item, target);
    score += areaClosenessScore(item, target);
    if (KNOWN_SOURCES.has(String(item.source || "").toUpperCase())) score += 5;
    if (item.isManualVerified) score += 15;
    return score;
}

function exclusionReason(item) {
    if (!numberOrNull(item?.price) || !usableArea(item)) return "PRICE_OR_M2_MISSING";
    if (!item?.listingUrl) return "LISTING_URL_MISSING";
    if (item?.imageStatus === "DEFAULT" && !hasLocation(item)) return "DEFAULT_IMAGE_WITH_CRITICAL_DATA_MISSING";
    return null;
}

function groupByPrice(candidates) {
    const sorted = [...candidates].sort((a, b) => a.pricePerSqm - b.pricePerSqm);
    const total = sorted.length;

    return sorted.map((item, index) => {
        let comparableGroup = "MID";
        if (total === 2) comparableGroup = index === 0 ? "LOW" : "HIGH";
        if (total >= 3) {
            const ratio = index / total;
            if (ratio < 1 / 3) comparableGroup = "LOW";
            else if (ratio < 2 / 3) comparableGroup = "MID";
            else comparableGroup = "HIGH";
        }
        return { ...item, comparableGroup };
    });
}

function sortGroupItems(items, target) {
    return [...items].sort((a, b) => {
        if (a.imageStatus !== b.imageStatus) return a.imageStatus === "REAL" ? -1 : 1;
        if (b.selectionScore !== a.selectionScore) return b.selectionScore - a.selectionScore;
        if (Number(b.confidenceScore || 0) !== Number(a.confidenceScore || 0)) {
            return Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0);
        }
        const areaDiffDelta = areaDiff(a, target) - areaDiff(b, target);
        if (areaDiffDelta !== 0) return areaDiffDelta;
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
}

function selectFromGroup(items, target) {
    const sorted = sortGroupItems(items, target);
    const real = sorted.filter((item) => item.imageStatus === "REAL");
    const fallback = sorted.filter((item) => item.imageStatus !== "REAL");

    if (real.length >= GROUP_TARGET) return real.slice(0, GROUP_TARGET);
    return [...real, ...fallback.slice(0, GROUP_TARGET - real.length)];
}

export function selectBestComparablesForReport(comparables = [], target = {}) {
    const deduped = dedupeComparableListings(comparables);
    const excluded = [];
    const usable = [];

    for (const item of deduped) {
        const reason = exclusionReason(item);
        if (reason) {
            excluded.push({ id: item.id, listingUrl: item.listingUrl, reason });
            continue;
        }

        const pricePerSqm = comparablePricePerSqm(item);
        usable.push({
            ...item,
            pricePerSqm,
            selectionScore: selectionScore({ ...item, pricePerSqm }, target),
        });
    }

    if (!usable.length) {
        return {
            selected: [],
            excluded,
            warnings: ["Rapor hesaplamasına uygun fiyat ve m² bilgisi olan emsal bulunamadı."],
            totalUsable: 0,
        };
    }

    const grouped = groupByPrice(usable);
    const selected = ["LOW", "MID", "HIGH"].flatMap((group) => {
        const groupItems = grouped.filter((item) => item.comparableGroup === group);
        return selectFromGroup(groupItems, target).map((item) => ({ ...item, comparableGroup: group }));
    });

    const warnings = [];
    if (selected.length < TARGET_TOTAL) {
        warnings.push(`Hedeflenen 18 emsal yerine veri uygunluğuna göre ${selected.length} emsal kullanılmıştır.`);
    }

    const defaultCount = selected.filter((item) => item.imageStatus === "DEFAULT").length;
    if (defaultCount > 0) {
        warnings.push(`Seçilen ${selected.length} emsalin ${defaultCount} tanesinde gerçek ilan fotoğrafı bulunamadığı için temsili görsel kullanılmıştır.`);
    }

    return {
        selected,
        excluded,
        warnings,
        totalUsable: usable.length,
    };
}

export default selectBestComparablesForReport;

