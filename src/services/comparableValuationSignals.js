import {
    comparableBuildingAge,
    comparablePrice,
    comparableUnitPrice,
    quantile,
    toNumber,
} from "./comparablePolicy.js";

function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function lowerTr(value) {
    return cleanText(value).toLocaleLowerCase("tr-TR");
}

function subjectRoomText(propertyDetails = {}) {
    const direct = cleanText(propertyDetails.roomText || propertyDetails.rooms);
    if (direct) return direct.replace(/\s+/g, "");

    const rooms = toNumber(propertyDetails.roomCount);
    const salons = toNumber(propertyDetails.salonCount);
    if (Number.isFinite(rooms) && Number.isFinite(salons)) return `${Math.round(rooms)}+${Math.round(salons)}`;
    return "";
}

function roomParts(roomText) {
    const match = cleanText(roomText).replace(/\s+/g, "").match(/^(\d+)\+(\d+)$/);
    if (!match) return null;
    return { rooms: Number(match[1]), salons: Number(match[2]) };
}

function roomScore(itemRoom, targetRoom) {
    const current = cleanText(itemRoom).replace(/\s+/g, "").toLocaleLowerCase("tr-TR");
    const target = cleanText(targetRoom).replace(/\s+/g, "").toLocaleLowerCase("tr-TR");
    if (!target || !current) return { score: 0, label: "unknown_room" };
    if (current === target) return { score: 15, label: "exact_room" };

    const c = roomParts(current);
    const t = roomParts(target);
    if (!c || !t) return { score: -8, label: "room_unclear" };
    if (c.salons !== t.salons) return { score: -18, label: "different_room" };
    if (Math.abs(c.rooms - t.rooms) === 1) return { score: -5, label: "near_room" };
    return { score: -22, label: "different_room" };
}

function comparableArea(item = {}) {
    return toNumber(item.netArea) || toNumber(item.grossArea) || null;
}

function subjectArea(propertyDetails = {}, landArea = null) {
    return toNumber(propertyDetails.netArea) || toNumber(propertyDetails.grossArea) || toNumber(landArea) || null;
}

function areaScore(itemArea, targetArea) {
    if (!Number.isFinite(itemArea) || !Number.isFinite(targetArea) || targetArea <= 0) {
        return { score: 0, ratio: null, label: "unknown_area" };
    }

    const ratio = itemArea / targetArea;
    if (ratio >= 0.85 && ratio <= 1.15) return { score: 15, ratio, label: "very_close_area" };
    if (ratio >= 0.7 && ratio <= 1.35) return { score: 8, ratio, label: "close_area" };
    if (ratio >= 0.55 && ratio <= 1.6) return { score: -4, ratio, label: "wide_area" };
    return { score: -18, ratio, label: "poor_area" };
}

function ageScore(itemAge, targetAge) {
    if (!Number.isFinite(itemAge) || !Number.isFinite(targetAge)) {
        if (Number.isFinite(targetAge) && targetAge >= 15) return { score: -8, diff: null, label: "unknown_age_for_old_subject" };
        return { score: 0, diff: null, label: "unknown_age" };
    }

    const diff = itemAge - targetAge;
    const abs = Math.abs(diff);
    if (abs <= 5) return { score: 13, diff, label: "close_age" };
    if (abs <= 10) return { score: 5, diff, label: "acceptable_age" };
    if (targetAge >= 20 && itemAge <= 8) return { score: -24, diff, label: "much_newer_comparable" };
    if (targetAge >= 15 && itemAge <= 5) return { score: -20, diff, label: "new_building_premium" };
    if (diff < -10) return { score: -12, diff, label: "newer_comparable" };
    return { score: -8, diff, label: "older_comparable" };
}

function booleanValue(value) {
    if (value === true || value === false) return value;
    const text = lowerTr(value);
    if (!text) return null;
    if (["true", "var", "evet", "1"].includes(text)) return true;
    if (["false", "yok", "hayır", "hayir", "0"].includes(text)) return false;
    return null;
}

function isTopOrRoofFloor(floor, totalFloors, floorText = "") {
    const text = lowerTr(floorText);
    if (/çatı|cati|teras|en üst|en ust|son kat/.test(text)) return true;
    if (Number.isFinite(floor) && Number.isFinite(totalFloors) && totalFloors >= 3) {
        return floor >= totalFloors - 1;
    }
    return false;
}

function floorScore(item = {}, propertyDetails = {}, buildingDetails = {}) {
    const subjectFloor = toNumber(propertyDetails.floor);
    const subjectTotalFloors = toNumber(buildingDetails.buildingFloors);
    const itemFloor = toNumber(item.floor);
    const itemTotalFloors = toNumber(item.totalFloors);
    const noElevator = booleanValue(buildingDetails.hasElevator) === false;
    const subjectTop = isTopOrRoofFloor(subjectFloor, subjectTotalFloors, propertyDetails.floorText);
    const itemTop = isTopOrRoofFloor(itemFloor, itemTotalFloors, item.floorText);

    let score = 0;
    const labels = [];

    if (noElevator && Number.isFinite(subjectFloor) && subjectFloor >= 3) {
        labels.push("subject_high_floor_no_elevator");
        if (!itemTop && Number.isFinite(itemFloor) && itemFloor <= 2) score -= 9;
        else score -= 5;
    }

    if (subjectTop) {
        labels.push("subject_top_floor");
        if (!itemTop) score -= 6;
    }

    if (!labels.length) labels.push("floor_neutral");
    return { score, labels };
}

function amenitySignals(item = {}, buildingDetails = {}) {
    const text = lowerTr([item.title, item.description, item.address, item.sourceUrl].filter(Boolean).join(" "));
    const subjectSite = booleanValue(buildingDetails.isSite);
    const subjectSecurity = booleanValue(buildingDetails.security);
    const subjectPool = booleanValue(buildingDetails.openPool) || booleanValue(buildingDetails.closedPool);
    const subjectParking = booleanValue(buildingDetails.openParking) || booleanValue(buildingDetails.closedParking);

    const luxury = /lüks|lux|ultra|rezidans|residence|sıfır|sifir|yeni bina|kapalı havuz|havuz|güvenlik|guvenlik|otopark|site/.test(text);
    const site = /site|rezidans|residence/.test(text);
    const pool = /havuz/.test(text);
    const security = /güvenlik|guvenlik/.test(text);
    const parking = /otopark|garaj/.test(text);

    let score = 0;
    const labels = [];
    if (luxury) labels.push("premium_listing_language");
    if (site && subjectSite === false) {
        score -= 7;
        labels.push("better_site_than_subject");
    }
    if (pool && !subjectPool) {
        score -= 5;
        labels.push("better_pool_than_subject");
    }
    if (security && subjectSecurity === false) {
        score -= 4;
        labels.push("better_security_than_subject");
    }
    if (parking && subjectParking === false) {
        score -= 3;
        labels.push("better_parking_than_subject");
    }
    if (luxury && !labels.some((label) => label.startsWith("better_"))) score -= 3;

    return { score, labels };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function subjectPenaltyPct(propertyDetails = {}, buildingDetails = {}) {
    const age = toNumber(buildingDetails.buildingAge);
    const floor = toNumber(propertyDetails.floor);
    const totalFloors = toNumber(buildingDetails.buildingFloors);
    const noElevator = booleanValue(buildingDetails.hasElevator) === false;
    const condition = lowerTr(buildingDetails.buildingCondition || propertyDetails.usageStatus);

    let penalty = 0;
    const reasons = [];

    if (Number.isFinite(age)) {
        if (age >= 30) {
            penalty += 24;
            reasons.push("30+ yaş bina");
        } else if (age >= 20) {
            penalty += 17;
            reasons.push("20+ yaş bina");
        } else if (age >= 15) {
            penalty += 11;
            reasons.push("15+ yaş bina");
        } else if (age >= 10) {
            penalty += 6;
            reasons.push("10+ yaş bina");
        }
    }

    if (noElevator && Number.isFinite(floor) && floor >= 3) {
        penalty += 9;
        reasons.push("asansörsüz yüksek kat");
    }

    if (isTopOrRoofFloor(floor, totalFloors, propertyDetails.floorText)) {
        penalty += 6;
        reasons.push("en üst/çatı kat etkisi");
    }

    if (/bakımsız|bakimsiz|tadilat|masraflı|masrafli|kötü|kotu/.test(condition)) {
        penalty += 7;
        reasons.push("tadilat/bakımsızlık riski");
    }

    return { pct: clamp(penalty, 0, 38), reasons };
}

function classifyRole(score, flags = []) {
    if (flags.includes("unit_price_outlier_high") || flags.includes("unit_price_outlier_low")) return "outlier_context";
    if (score >= 78) return "primary";
    if (score >= 62) return "supporting";
    return "context_only";
}

function roleWeight(role) {
    if (role === "primary") return 1;
    if (role === "supporting") return 0.45;
    return 0.15;
}

function percentile(values, ratio) {
    return quantile(values.filter(Number.isFinite), ratio);
}

function roundPrice(value) {
    return Number.isFinite(value) ? Math.round(value / 50_000) * 50_000 : null;
}

function buildComparableValuationSignals(comparables = [], { propertyDetails = {}, buildingDetails = {}, landArea = null } = {}) {
    const targetArea = subjectArea(propertyDetails, landArea);
    const targetRoom = subjectRoomText(propertyDetails);
    const targetAge = toNumber(buildingDetails.buildingAge);
    const unitPrices = comparables.map(comparableUnitPrice).filter(Number.isFinite);
    const q1 = percentile(unitPrices, 0.25);
    const q3 = percentile(unitPrices, 0.75);
    const iqr = Number.isFinite(q1) && Number.isFinite(q3) ? q3 - q1 : null;
    const highOutlier = Number.isFinite(iqr) ? q3 + iqr * 1.25 : null;
    const lowOutlier = Number.isFinite(iqr) ? Math.max(1, q1 - iqr * 1.25) : null;

    const annotatedComparables = comparables.map((item) => {
        const itemArea = comparableArea(item);
        const itemAge = comparableBuildingAge(item);
        const room = roomScore(item.roomText, targetRoom);
        const area = areaScore(itemArea, targetArea);
        const age = ageScore(itemAge, targetAge);
        const floor = floorScore(item, propertyDetails, buildingDetails);
        const amenity = amenitySignals(item, buildingDetails);
        const unitPrice = comparableUnitPrice(item);
        const flags = [];
        const notes = [room.label, area.label, age.label, ...floor.labels, ...amenity.labels].filter(Boolean);

        let score = 55 + room.score + area.score + age.score + floor.score + amenity.score;
        if (Number.isFinite(unitPrice) && Number.isFinite(highOutlier) && unitPrice > highOutlier) {
            score -= 18;
            flags.push("unit_price_outlier_high");
            notes.push("yüksek birim fiyat uç değer");
        }
        if (Number.isFinite(unitPrice) && Number.isFinite(lowOutlier) && unitPrice < lowOutlier) {
            score -= 10;
            flags.push("unit_price_outlier_low");
            notes.push("düşük birim fiyat uç değer");
        }

        if (age.label === "much_newer_comparable" || age.label === "new_building_premium") {
            flags.push("better_than_subject");
            notes.push("konu taşınmazdan belirgin yeni");
        }
        if (amenity.labels.some((label) => label.startsWith("better_"))) {
            flags.push("better_than_subject");
            notes.push("donatı/segment olarak konu taşınmazdan iyi");
        }

        score = Math.round(clamp(score, 0, 100));
        const valuationRole = classifyRole(score, flags);

        return {
            ...item,
            valuationSignals: {
                fitScore: score,
                valuationRole,
                valuationWeight: roleWeight(valuationRole),
                subjectComparison: flags.includes("better_than_subject") ? "better_than_subject" : score >= 78 ? "similar_to_subject" : "weaker_or_uncertain_fit",
                areaRatio: area.ratio === null ? null : Number(area.ratio.toFixed(2)),
                ageDiff: age.diff,
                activeListingDiscountPct: item.longListed ? 15 : 10,
                adjustmentNotes: [...new Set(notes)].slice(0, 8),
                flags,
            },
        };
    });

    const primary = annotatedComparables.filter((item) => item.valuationSignals.valuationRole === "primary");
    const supporting = annotatedComparables.filter((item) => item.valuationSignals.valuationRole === "supporting");
    const contextOnly = annotatedComparables.filter((item) => item.valuationSignals.valuationRole === "context_only");
    const outliers = annotatedComparables.filter((item) => item.valuationSignals.valuationRole === "outlier_context");
    const weighted = [...primary, ...supporting];
    const anchorItems = weighted.length >= 3 ? weighted : annotatedComparables.filter((item) => item.valuationSignals.valuationRole !== "outlier_context");
    const anchorUnitPrices = anchorItems.map(comparableUnitPrice).filter(Number.isFinite);
    const penalty = subjectPenaltyPct(propertyDetails, buildingDetails);
    const betterAnchorCount = anchorItems.filter((item) => item.valuationSignals.subjectComparison === "better_than_subject").length;
    const betterAnchorShare = anchorItems.length ? betterAnchorCount / anchorItems.length : 0;
    const baseEffectivePenaltyPct = penalty.pct * (0.2 + betterAnchorShare * 0.8);
    const minimumPenaltyPct = penalty.pct >= 20 ? penalty.pct * 0.75 : 0;
    const effectivePenaltyPct = Math.round(Math.max(baseEffectivePenaltyPct, minimumPenaltyPct));
    let discountPct = 10;
    if (penalty.pct === 0 && betterAnchorShare < 0.2) discountPct = 4;
    else if (penalty.pct < 10) discountPct = 8;
    else if (penalty.pct < 20 && betterAnchorShare < 0.2) discountPct = 6;
    else if (penalty.pct >= 25) discountPct = 14;
    else if (penalty.pct >= 15) discountPct = 12;
    if (outliers.length >= 3 && primary.length < 5) discountPct = Math.max(discountPct, 14);
    if (betterAnchorShare >= 0.45) discountPct = Math.min(18, discountPct + 3);
    const anchorMedianUnit = percentile(anchorUnitPrices, 0.5);
    const anchorLowUnit = percentile(anchorUnitPrices, 0.25);
    const anchorVeryLowUnit = percentile(anchorUnitPrices, 0.1);
    const shouldUseLowerAnchor =
        (penalty.pct >= 20 || outliers.length >= 3 || (primary.length < 5 && betterAnchorShare >= 0.2)) &&
        Number.isFinite(anchorLowUnit);
    const expectedAnchorUnit = shouldUseLowerAnchor ? anchorLowUnit : anchorMedianUnit;
    const lowAnchorUnit = penalty.pct >= 20 && Number.isFinite(anchorVeryLowUnit) ? anchorVeryLowUnit : anchorLowUnit;
    const suggestedExpectedPrice =
        Number.isFinite(expectedAnchorUnit) && Number.isFinite(targetArea)
            ? roundPrice(expectedAnchorUnit * targetArea * (1 - discountPct / 100) * (1 - Math.min(effectivePenaltyPct, 30) / 100))
            : null;
    const suggestedLowPrice =
        Number.isFinite(lowAnchorUnit) && Number.isFinite(targetArea)
            ? roundPrice(lowAnchorUnit * targetArea * (1 - Math.min(discountPct + 3, 18) / 100) * (1 - Math.min(effectivePenaltyPct, 32) / 100))
            : null;

    return {
        comparables: annotatedComparables,
        guidance: {
            targetComparableCount: comparables.length,
            primaryCount: primary.length,
            supportingCount: supporting.length,
            contextOnlyCount: contextOnly.length,
            outlierCount: outliers.length,
            strictPricingSampleCount: primary.length + supporting.length,
            activeListingRealizationDiscountPct: discountPct,
            subjectPenaltyPct: penalty.pct,
            effectiveComparableAdjustmentPct: effectivePenaltyPct,
            betterComparableShare: Number(betterAnchorShare.toFixed(2)),
            subjectPenaltyReasons: penalty.reasons,
            recommendedPricingBasis: primary.length >= 5 ? "primary_comparables" : "primary_plus_supporting_comparables",
            recommendedAnchor: {
                anchorUnitPriceMedian: Number.isFinite(anchorMedianUnit) ? Math.round(anchorMedianUnit) : null,
                anchorUnitPriceLowQuartile: Number.isFinite(anchorLowUnit) ? Math.round(anchorLowUnit) : null,
                anchorUnitPriceVeryLow: Number.isFinite(anchorVeryLowUnit) ? Math.round(anchorVeryLowUnit) : null,
                expectedAnchorUnitPrice: Number.isFinite(expectedAnchorUnit) ? Math.round(expectedAnchorUnit) : null,
                suggestedLowPrice,
                suggestedExpectedPrice,
            },
            rules: [
                "Tüm ilanları gösterim bağlamı olarak gör, fiyatı primary ve supporting emsallerden kur.",
                "better_than_subject veya outlier_context emsalleri fiyatı yukarı taşımak için ana referans yapma.",
                "Aktif ilan fiyatını gerçekleşmiş satış fiyatı gibi alma; activeListingRealizationDiscountPct uygula.",
                "Konu taşınmaz cezalıysa beklenen fiyatı bandın alt-orta tarafında kur.",
            ],
        },
    };
}

export { buildComparableValuationSignals };
