const TARGET_GROUP_SIZE = 6;
const TARGET_TOTAL = TARGET_GROUP_SIZE * 3;
const PROVIDER_TIMEOUT_MS = 45000;

function toNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    let normalized = String(value).trim().replace(/[^\d.,-]/g, "");
    if (normalized.includes(",")) {
        normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
        normalized = normalized.replace(/\./g, "");
    } else if ((normalized.match(/\./g) || []).length > 1) {
        normalized = normalized.replace(/\./g, "");
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function comparableKey(item) {
    return item?.externalId || item?.sourceUrl || `${item?.title || ""}:${item?.price || ""}:${item?.netArea || item?.grossArea || ""}`;
}

function comparableArea(item) {
    return toNumber(item?.netArea) || toNumber(item?.grossArea);
}

function comparableUnitPrice(item) {
    const direct = toNumber(item?.pricePerSqm);
    if (direct && direct > 0) return direct;

    const price = toNumber(item?.price);
    const area = comparableArea(item);
    if (!price || !area || area <= 0) return null;

    return Math.round(price / area);
}

function priceMetric(item) {
    return comparableUnitPrice(item) || toNumber(item?.price);
}

function hasImage(item) {
    return Boolean(String(item?.imageUrl || "").trim());
}

function hasRoom(item) {
    return Boolean(String(item?.roomText || "").trim());
}

function roomMatches(itemRoom, targetRoom) {
    const current = String(itemRoom || "").replace(/\s+/g, "").toLocaleLowerCase("tr-TR");
    const target = String(targetRoom || "").replace(/\s+/g, "").toLocaleLowerCase("tr-TR");
    return Boolean(current && target && current === target);
}

function isLikelyTestListing(item) {
    const text = `${item?.title || ""} ${item?.address || ""}`.toLocaleLowerCase("tr-TR");
    return text.includes("test") || text.includes("dikkate almayin") || text.includes("dikkate almayın");
}

function uniqueComparables(items = []) {
    const seen = new Set();
    const out = [];

    for (const item of Array.isArray(items) ? items : []) {
        const key = comparableKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }

    return out;
}

function quantile(values, ratio) {
    const list = values.map(toNumber).filter(Number.isFinite).sort((a, b) => a - b);
    if (!list.length) return null;

    const pos = (list.length - 1) * ratio;
    const lower = Math.floor(pos);
    const upper = Math.ceil(pos);
    if (lower === upper) return list[lower];

    return list[lower] * (1 - (pos - lower)) + list[upper] * (pos - lower);
}

function trimOutliers(items = []) {
    const clean = items.filter((item) => {
        if (isLikelyTestListing(item)) return false;

        const price = toNumber(item?.price);
        const unit = comparableUnitPrice(item);

        if (!Number.isFinite(price) || price <= 0) return false;
        if (Number.isFinite(unit) && unit < 1000) return false;

        return true;
    });

    const unitPrices = clean.map(comparableUnitPrice).filter(Number.isFinite).sort((a, b) => a - b);
    if (unitPrices.length < 8) return clean;

    const q1 = quantile(unitPrices, 0.25);
    const q3 = quantile(unitPrices, 0.75);
    const iqr = q3 - q1;
    const lower = Math.max(1, q1 - iqr * 1.5);
    const upper = q3 + iqr * 1.5;
    const filtered = clean.filter((item) => {
        const unit = comparableUnitPrice(item);
        if (!Number.isFinite(unit)) return true;
        return unit >= lower && unit <= upper;
    });

    return filtered.length >= TARGET_GROUP_SIZE ? filtered : clean;
}

function qualityScore(item, options = {}) {
    let score = 0;

    if (hasImage(item)) score += 20;
    if (Number.isFinite(toNumber(item?.price))) score += 8;
    if (Number.isFinite(comparableArea(item))) score += 8;
    if (hasRoom(item)) score += 4;
    if (roomMatches(item?.roomText, options.subjectRoomText)) score += 8;

    const area = toNumber(options.subjectArea);
    const itemArea = comparableArea(item);
    if (Number.isFinite(area) && area > 0 && Number.isFinite(itemArea) && itemArea > 0) {
        const ratio = itemArea / area;
        if (ratio >= 0.8 && ratio <= 1.25) score += 8;
        else if (ratio >= 0.65 && ratio <= 1.5) score += 5;
        else if (ratio >= 0.35 && ratio <= 2.5) score += 2;
    }

    const distance = toNumber(item?.distanceMeters);
    if (Number.isFinite(distance)) {
        if (distance <= 1500) score += 6;
        else if (distance <= 3000) score += 4;
        else if (distance <= 6000) score += 2;
    }

    const source = String(item?.source || item?.provider || "").toLocaleLowerCase("tr-TR");
    if (source.includes("hepsiemlak")) score += 3;
    if (source.includes("re/max") || source.includes("remax")) score += 3;
    if (source.includes("sahibinden")) score += 2;
    if (source.includes("emlakjet")) score += 2;

    return score;
}

function selectBest(items, count, usedKeys, options = {}) {
    return items
        .filter((item) => !usedKeys.has(comparableKey(item)))
        .slice()
        .sort((a, b) => {
            const scoreDiff = qualityScore(b, options) - qualityScore(a, options);
            if (scoreDiff) return scoreDiff;
            return (priceMetric(a) || Number.MAX_SAFE_INTEGER) - (priceMetric(b) || Number.MAX_SAFE_INTEGER);
        })
        .slice(0, count);
}

function selectPortfolioGroups(items = [], options = {}) {
    const unique = uniqueComparables(items);
    const priced = unique.filter((item) => Number.isFinite(toNumber(item?.price)) && Number.isFinite(priceMetric(item)));
    const withArea = priced.filter((item) => Number.isFinite(comparableArea(item)));
    let pool = withArea.length >= TARGET_TOTAL ? withArea : priced;

    const photoReady = pool.filter((item) => hasImage(item) && Number.isFinite(comparableArea(item)));
    if (photoReady.length >= TARGET_TOTAL) pool = photoReady;

    pool = trimOutliers(pool).sort((a, b) => (priceMetric(a) || 0) - (priceMetric(b) || 0));

    const third = Math.max(TARGET_GROUP_SIZE, Math.ceil(pool.length / 3));
    const lowBand = pool.slice(0, third);
    const highBand = pool.slice(Math.max(0, pool.length - third));
    const midStart = Math.max(0, Math.floor(pool.length / 2) - Math.ceil(third / 2));
    const midBand = pool.slice(midStart, midStart + third);

    const used = new Set();
    const low = selectBest(lowBand, TARGET_GROUP_SIZE, used, options);
    low.forEach((item) => used.add(comparableKey(item)));

    const mid = selectBest(midBand, TARGET_GROUP_SIZE, used, options);
    mid.forEach((item) => used.add(comparableKey(item)));

    const high = selectBest(highBand, TARGET_GROUP_SIZE, used, options);
    high.forEach((item) => used.add(comparableKey(item)));

    const groups = { low, mid, high };
    for (const key of ["low", "mid", "high"]) {
        if (groups[key].length >= TARGET_GROUP_SIZE) continue;
        const fill = selectBest(pool, TARGET_GROUP_SIZE - groups[key].length, used, options);
        fill.forEach((item) => used.add(comparableKey(item)));
        groups[key].push(...fill);
    }

    const tagged = [
        ...groups.low.map((item) => ({ ...item, group: "low" })),
        ...groups.mid.map((item) => ({ ...item, group: "mid" })),
        ...groups.high.map((item) => ({ ...item, group: "high" })),
    ];

    const finalComparables = uniqueComparables(tagged).slice(0, TARGET_TOTAL);
    const finalGroups = {
        low: finalComparables.filter((item) => item.group === "low").map(comparableKey).filter(Boolean),
        mid: finalComparables.filter((item) => item.group === "mid").map(comparableKey).filter(Boolean),
        high: finalComparables.filter((item) => item.group === "high").map(comparableKey).filter(Boolean),
    };

    return {
        comparables: finalComparables,
        groups: finalGroups,
        diagnostics: {
            rawCount: unique.length,
            pricedCount: priced.length,
            areaCount: withArea.length,
            imageCount: pool.filter(hasImage).length,
            selectedCount: finalComparables.length,
            targetTotal: TARGET_TOTAL,
        },
    };
}

export {
    PROVIDER_TIMEOUT_MS,
    TARGET_GROUP_SIZE,
    TARGET_TOTAL,
    comparableKey,
    comparableUnitPrice,
    priceMetric,
    quantile,
    selectPortfolioGroups,
    toNumber,
    uniqueComparables,
};
