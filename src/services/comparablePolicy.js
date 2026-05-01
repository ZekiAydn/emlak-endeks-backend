const TARGET_GROUP_SIZE = 6;
const TARGET_STALE_GROUP_SIZE = 6;
const TARGET_TOTAL = TARGET_GROUP_SIZE * 3 + TARGET_STALE_GROUP_SIZE;
const PROVIDER_TIMEOUT_MS = 45000;
const MIN_VALUATION_SAMPLE = 3;
const LONG_LISTED_MIN_DAYS = 45;

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
    return item?.sourceUrl || item?.externalId || `${item?.title || ""}:${item?.price || ""}:${item?.netArea || item?.grossArea || ""}`;
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

function comparablePrice(item) {
    const price = toNumber(item?.price);
    return Number.isFinite(price) && price > 0 ? price : null;
}

function comparableAgeDays(item = {}, now = Date.now()) {
    const direct = toNumber(item?.daysOnMarket);
    if (Number.isFinite(direct) && direct >= 0) return Math.round(direct);

    const dateValue = item.createdAt || item.listingDate || item.publishedAt || item.firstSeenAt;
    if (!dateValue) return null;

    const date = new Date(dateValue);
    const time = date.getTime();
    if (!Number.isFinite(time) || time > now + 86400000) return null;

    return Math.max(0, Math.floor((now - time) / 86400000));
}

function comparableBuildingAge(item = {}) {
    const direct = toNumber(item?.buildingAge);
    if (Number.isFinite(direct) && direct >= 0) return Math.round(direct);

    const text = String(item?.buildingAgeText || "").toLocaleLowerCase("tr-TR");
    if (!text) return null;
    if (/sıfır|sifir|0\s*yaş|0\s*yas|yeni/.test(text)) return 0;

    const match = text.match(/(\d{1,2})/);
    if (!match) return null;

    const parsed = Number(match[1]);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function withAgeMeta(item = {}, now = Date.now()) {
    const days = comparableAgeDays(item, now);
    if (days === null) return item;

    return {
        ...item,
        daysOnMarket: days,
        longListed: days >= LONG_LISTED_MIN_DAYS,
    };
}

function priceMetric(item) {
    return comparablePrice(item);
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

function isStudioRoom(roomText) {
    return /stüdyo|studio|1\+0/i.test(String(roomText || ""));
}

function roomParts(roomText) {
    const match = String(roomText || "").replace(/\s+/g, "").match(/^(\d+)\+(\d+)$/);
    if (!match) return null;

    const bedrooms = Number(match[1]);
    const livingRooms = Number(match[2]);
    if (!Number.isFinite(bedrooms) || !Number.isFinite(livingRooms)) return null;

    return { bedrooms, livingRooms };
}

function roomCompatible(itemRoom, targetRoom, { allowUnknown = false } = {}) {
    if (roomMatches(itemRoom, targetRoom)) return true;
    if (!itemRoom) return allowUnknown;
    if (isStudioRoom(itemRoom)) return false;

    const current = roomParts(itemRoom);
    const target = roomParts(targetRoom);
    if (!current || !target) return allowUnknown;

    if (target.bedrooms >= 2 && current.bedrooms <= 1) return false;
    if (Math.abs(current.bedrooms - target.bedrooms) > 1) return false;
    if (current.livingRooms !== target.livingRooms) return false;

    return true;
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

function trimPriceOutliers(items = []) {
    const clean = items.filter((item) => {
        if (isLikelyTestListing(item)) return false;
        return Number.isFinite(comparablePrice(item));
    });

    const prices = clean.map(comparablePrice).filter(Number.isFinite).sort((a, b) => a - b);
    if (prices.length < 8) return clean;

    const q1 = quantile(prices, 0.25);
    const q3 = quantile(prices, 0.75);
    const iqr = q3 - q1;
    const lower = Math.max(1, q1 - iqr * 1.5);
    const upper = q3 + iqr * 1.5;
    const filtered = clean.filter((item) => {
        const price = comparablePrice(item);
        return Number.isFinite(price) && price >= lower && price <= upper;
    });

    return filtered.length >= MIN_VALUATION_SAMPLE ? filtered : clean;
}

function qualityScore(item, options = {}) {
    let score = 0;

    if (hasImage(item)) score += 20;
    if (Number.isFinite(toNumber(item?.price))) score += 8;
    if (Number.isFinite(comparableArea(item))) score += 8;
    if (hasRoom(item)) score += 4;
    if (roomMatches(item?.roomText, options.subjectRoomText)) score += 8;

    const subjectBuildingAge = toNumber(options.subjectBuildingAge);
    const itemBuildingAge = comparableBuildingAge(item);
    if (Number.isFinite(subjectBuildingAge) && Number.isFinite(itemBuildingAge)) {
        const diff = Math.abs(itemBuildingAge - subjectBuildingAge);
        if (subjectBuildingAge <= 5 && itemBuildingAge <= 5) score += 10;
        else if (diff <= 3) score += 6;
        else if (diff <= 8) score += 3;
    }

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

function selectLongListed(items, count, usedKeys, options = {}) {
    const minDays = toNumber(options.longListedMinDays) ?? LONG_LISTED_MIN_DAYS;

    return items
        .filter((item) => !usedKeys.has(comparableKey(item)))
        .filter((item) => Number.isFinite(comparablePrice(item)))
        .filter((item) => {
            const days = comparableAgeDays(item);
            return Number.isFinite(days) && days >= minDays;
        })
        .slice()
        .sort((a, b) => {
            const ageDiff = (comparableAgeDays(b) || 0) - (comparableAgeDays(a) || 0);
            if (ageDiff) return ageDiff;

            const unitDiff = (comparableUnitPrice(b) || 0) - (comparableUnitPrice(a) || 0);
            if (unitDiff) return unitDiff;

            return (comparablePrice(b) || 0) - (comparablePrice(a) || 0);
        })
        .slice(0, count);
}

function sortByPrice(items = []) {
    return items.slice().sort((a, b) => (comparablePrice(a) || 0) - (comparablePrice(b) || 0));
}

function filterByComparableArea(items = [], options = {}) {
    const subjectArea = toNumber(options.subjectArea);
    if (!Number.isFinite(subjectArea) || subjectArea <= 0) return items;

    const isLand = options.propertyCategory === "land";
    const minRatio = isLand ? 0.2 : 0.45;
    const maxRatio = isLand ? 5 : 1.9;
    const areaMatched = items.filter((item) => {
        const area = comparableArea(item);
        if (!Number.isFinite(area) || area <= 0) return false;
        const ratio = area / subjectArea;
        return ratio >= minRatio && ratio <= maxRatio;
    });

    return areaMatched.length >= MIN_VALUATION_SAMPLE ? areaMatched : items;
}

function filterByBuildingAge(items = [], options = {}) {
    const subjectBuildingAge = toNumber(options.subjectBuildingAge);
    if (!Number.isFinite(subjectBuildingAge) || subjectBuildingAge < 0) return items;

    let ageMatched = [];
    if (subjectBuildingAge <= 5) {
        ageMatched = items.filter((item) => {
            const age = comparableBuildingAge(item);
            return Number.isFinite(age) && age <= 5;
        });
    } else {
        ageMatched = items.filter((item) => {
            const age = comparableBuildingAge(item);
            return Number.isFinite(age) && Math.abs(age - subjectBuildingAge) <= 8;
        });
    }

    return ageMatched.length >= MIN_VALUATION_SAMPLE ? ageMatched : items;
}

function selectValuationComparables(items = [], options = {}) {
    let pool = uniqueComparables(items).filter((item) => Number.isFinite(comparablePrice(item)));
    if (!pool.length) return [];

    pool = trimOutliers(pool);
    const targetRoom = String(options.subjectRoomText || "").trim();

    if (targetRoom) {
        const exactRoom = pool.filter((item) => roomMatches(item?.roomText, targetRoom));
        if (exactRoom.length >= MIN_VALUATION_SAMPLE) {
            pool = exactRoom;
        } else {
            const compatibleRoom = pool.filter((item) => roomCompatible(item?.roomText, targetRoom, { allowUnknown: false }));
            if (compatibleRoom.length >= MIN_VALUATION_SAMPLE) {
                pool = compatibleRoom;
            } else if (/^[2-9]\+/.test(targetRoom)) {
                const withoutStudios = pool.filter((item) => !isStudioRoom(item?.roomText));
                if (withoutStudios.length >= MIN_VALUATION_SAMPLE) pool = withoutStudios;
            }
        }
    }

    pool = filterByComparableArea(pool, options);
    pool = filterByBuildingAge(pool, options);
    pool = trimPriceOutliers(pool);

    return sortByPrice(pool);
}

function selectPortfolioGroups(items = [], options = {}) {
    const now = Date.now();
    const unique = uniqueComparables(items).map((item) => withAgeMeta(item, now));
    const priced = unique.filter((item) => Number.isFinite(comparablePrice(item)));
    const withArea = priced.filter((item) => Number.isFinite(comparableArea(item)));
    let pool = withArea.length >= TARGET_TOTAL ? withArea : priced;

    const photoReady = pool.filter((item) => hasImage(item) && Number.isFinite(comparableArea(item)));
    if (photoReady.length >= TARGET_TOTAL) pool = photoReady;

    pool = trimOutliers(pool).sort((a, b) => (comparablePrice(a) || 0) - (comparablePrice(b) || 0));

    if (options.subjectRoomText) {
        const roomCompatiblePool = pool.filter((item) => roomCompatible(item?.roomText, options.subjectRoomText, { allowUnknown: true }));
        if (roomCompatiblePool.length >= MIN_VALUATION_SAMPLE) pool = roomCompatiblePool;
    }

    const used = new Set();
    const stale = selectLongListed(pool, TARGET_STALE_GROUP_SIZE, used, options);
    stale.forEach((item) => used.add(comparableKey(item)));

    const third = Math.max(TARGET_GROUP_SIZE, Math.ceil(pool.length / 3));
    const lowBand = pool.slice(0, third);
    const highBand = pool.slice(Math.max(0, pool.length - third));
    const midStart = Math.max(0, Math.floor(pool.length / 2) - Math.ceil(third / 2));
    const midBand = pool.slice(midStart, midStart + third);

    const low = sortByPrice(selectBest(lowBand, TARGET_GROUP_SIZE, used, options));
    low.forEach((item) => used.add(comparableKey(item)));

    const mid = sortByPrice(selectBest(midBand, TARGET_GROUP_SIZE, used, options));
    mid.forEach((item) => used.add(comparableKey(item)));

    const high = sortByPrice(selectBest(highBand, TARGET_GROUP_SIZE, used, options));
    high.forEach((item) => used.add(comparableKey(item)));

    const groups = { low, mid, high };
    for (const key of ["low", "mid", "high"]) {
        if (groups[key].length >= TARGET_GROUP_SIZE) continue;
        const fill = sortByPrice(selectBest(pool, TARGET_GROUP_SIZE - groups[key].length, used, options));
        fill.forEach((item) => used.add(comparableKey(item)));
        groups[key].push(...fill);
        groups[key] = sortByPrice(groups[key]);
    }

    const tagged = [
        ...groups.low.map((item) => ({ ...item, group: "low" })),
        ...groups.mid.map((item) => ({ ...item, group: "mid" })),
        ...groups.high.map((item) => ({ ...item, group: "high" })),
        ...stale.map((item) => ({ ...item, group: "stale", longListed: true })),
    ];

    const finalComparables = uniqueComparables(tagged).slice(0, TARGET_TOTAL);
    const finalGroups = {
        low: finalComparables.filter((item) => item.group === "low").map(comparableKey).filter(Boolean),
        mid: finalComparables.filter((item) => item.group === "mid").map(comparableKey).filter(Boolean),
        high: finalComparables.filter((item) => item.group === "high").map(comparableKey).filter(Boolean),
        stale: finalComparables.filter((item) => item.group === "stale").map(comparableKey).filter(Boolean),
    };

    return {
        comparables: finalComparables,
        groups: finalGroups,
        diagnostics: {
            rawCount: unique.length,
            pricedCount: priced.length,
            areaCount: withArea.length,
            imageCount: pool.filter(hasImage).length,
            longListedCount: stale.length,
            longListedMinDays: LONG_LISTED_MIN_DAYS,
            selectedCount: finalComparables.length,
            targetTotal: TARGET_TOTAL,
        },
    };
}

export {
    PROVIDER_TIMEOUT_MS,
    TARGET_GROUP_SIZE,
    TARGET_STALE_GROUP_SIZE,
    TARGET_TOTAL,
    LONG_LISTED_MIN_DAYS,
    comparableAgeDays,
    comparableBuildingAge,
    comparableKey,
    comparablePrice,
    comparableUnitPrice,
    priceMetric,
    quantile,
    selectPortfolioGroups,
    selectValuationComparables,
    toNumber,
    uniqueComparables,
};
