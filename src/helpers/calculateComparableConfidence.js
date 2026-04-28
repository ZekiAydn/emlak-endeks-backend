const KNOWN_SOURCES = new Set(["HEPSIEMLAK", "EMLAKJET", "REMAX", "SAHIBINDEN"]);

function hasValue(value) {
    return value !== undefined && value !== null && value !== "";
}

function hasArea(item) {
    return Number.isFinite(Number(item?.grossM2)) || Number.isFinite(Number(item?.netM2));
}

function hasLocation(item) {
    return Boolean(
        item?.addressText ||
        (item?.city && item?.district) ||
        (item?.city && item?.neighborhood) ||
        (item?.district && item?.neighborhood)
    );
}

export function calculateComparableConfidence(item = {}) {
    let score = 0;

    if (Number.isFinite(Number(item.price))) score += 20;
    if (hasArea(item)) score += 20;
    score += item.imageStatus === "REAL" ? 15 : item.imageUrl ? 5 : 0;
    if (hasLocation(item)) score += 15;
    if (Number.isInteger(Number(item.roomCount))) score += 10;
    if (item.listingUrl) score += 10;
    if (KNOWN_SOURCES.has(String(item.source || "").toUpperCase())) score += 5;
    if (hasValue(item.buildingAge) || hasValue(item.floor) || hasValue(item.heating)) score += 5;
    if (item.isManualVerified) score += 10;

    const missingCritical = [];
    if (!Number.isFinite(Number(item.price))) missingCritical.push("price");
    if (!hasArea(item)) missingCritical.push("areaM2");
    if (!item.listingUrl) missingCritical.push("listingUrl");
    if (!hasLocation(item)) missingCritical.push("location");

    score -= missingCritical.length * 10;

    return Math.max(0, Math.min(100, Math.round(score)));
}

export default calculateComparableConfidence;

