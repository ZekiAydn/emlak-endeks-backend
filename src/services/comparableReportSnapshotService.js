import prisma from "../prisma.js";
import { getDefaultComparableImage } from "../helpers/defaultComparableImage.js";
import { findReportForUser, comparableSelect } from "./comparableSearchService.js";

const TARGET_SELECTION = {
    total: 18,
    low: 6,
    mid: 6,
    high: 6,
};

function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function usableArea(item) {
    return numberOrNull(item?.grossM2) > 0 ? numberOrNull(item.grossM2) : numberOrNull(item?.netM2) > 0 ? numberOrNull(item.netM2) : null;
}

function pricePerSqm(item) {
    const price = numberOrNull(item?.price);
    const area = usableArea(item);
    return price && area ? Math.round((price / area) * 100) / 100 : null;
}

function average(values = []) {
    const valid = values.map(Number).filter(Number.isFinite);
    if (!valid.length) return null;
    return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 100) / 100;
}

function min(values = []) {
    const valid = values.map(Number).filter(Number.isFinite);
    return valid.length ? Math.min(...valid) : null;
}

function max(values = []) {
    const valid = values.map(Number).filter(Number.isFinite);
    return valid.length ? Math.max(...valid) : null;
}

function actualSelection(selected) {
    return {
        total: selected.length,
        low: selected.filter((item) => item.comparableGroup === "LOW").length,
        mid: selected.filter((item) => item.comparableGroup === "MID").length,
        high: selected.filter((item) => item.comparableGroup === "HIGH").length,
    };
}

function excludedReason(item) {
    if (!numberOrNull(item.price) || !usableArea(item)) return "PRICE_OR_M2_MISSING";
    if (!item.listingUrl) return "LISTING_URL_MISSING";
    if (!item.isSelectedForReport) return "NOT_SELECTED";
    return null;
}

function snapshotComparable(item) {
    return {
        id: item.id,
        source: item.source,
        title: item.title,
        price: item.price,
        currency: item.currency,
        grossM2: item.grossM2,
        netM2: item.netM2,
        pricePerSqm: item.pricePerSqm ?? pricePerSqm(item),
        roomCount: item.roomCount,
        salonCount: item.salonCount,
        city: item.city,
        district: item.district,
        neighborhood: item.neighborhood,
        addressText: item.addressText,
        imageUrl: item.imageUrl,
        imageStatus: item.imageStatus,
        listingUrl: item.listingUrl,
        confidenceScore: item.confidenceScore,
        comparableGroup: item.comparableGroup,
    };
}

export function buildComparableReportSnapshot(allComparables = []) {
    const all = Array.isArray(allComparables) ? allComparables : [];
    const selected = all.filter((item) => item.isSelectedForReport).map((item) => ({
        ...item,
        pricePerSqm: item.pricePerSqm ?? pricePerSqm(item),
    }));
    const usable = all.filter((item) => numberOrNull(item.price) && usableArea(item));
    const selectedSnapshots = selected.map(snapshotComparable);
    const defaultImageCount = selected.filter((item) => item.imageStatus === "DEFAULT").length;
    const realImageCount = selected.filter((item) => item.imageStatus === "REAL").length;
    const parsedAreaCount = selected.filter((item) => String(item.parsedRaw?.areaSource || "").startsWith("TEXT_")).length;

    const warnings = [];
    if (selected.length < TARGET_SELECTION.total) {
        warnings.push(`Hedeflenen 18 emsal yerine veri uygunluğuna göre ${selected.length} emsal kullanılmıştır.`);
    }
    if (defaultImageCount > 0) {
        warnings.push(`Seçilen ${selected.length} emsalin ${defaultImageCount} tanesinde gerçek ilan fotoğrafı bulunamadığı için temsili görsel kullanılmıştır.`);
    }
    if (parsedAreaCount > 0) {
        warnings.push("Bazı ilanlarda m² bilgisi başlık/snippet üzerinden tahmini parse edilmiştir.");
    }

    const excluded = all
        .filter((item) => !item.isSelectedForReport)
        .map((item) => ({
            id: item.id,
            reason: excludedReason(item),
        }))
        .filter((item) => item.reason);

    return {
        generatedAt: new Date().toISOString(),
        sourceMode: "SERP_API_WITH_MANUAL_VERIFICATION",
        targetSelection: TARGET_SELECTION,
        actualSelection: actualSelection(selected),
        summary: {
            totalFound: all.length,
            totalUsable: usable.length,
            totalSelected: selected.length,
            averagePrice: average(selected.map((item) => item.price)),
            averagePricePerSqm: average(selected.map((item) => item.pricePerSqm ?? pricePerSqm(item))),
            minPrice: min(selected.map((item) => item.price)),
            maxPrice: max(selected.map((item) => item.price)),
            confidenceAverage: average(selected.map((item) => item.confidenceScore)),
            imageSummary: {
                realImageCount,
                defaultImageCount,
                defaultImageUrl: getDefaultComparableImage(),
            },
        },
        selected: selectedSnapshots,
        excluded,
        warnings,
    };
}

export async function snapshotReportComparables(userId, reportId) {
    await findReportForUser(userId, reportId);

    const comparables = await prisma.comparableListing.findMany({
        where: { userId, reportId },
        orderBy: [
            { isSelectedForReport: "desc" },
            { comparableGroup: "asc" },
            { pricePerSqm: "asc" },
        ],
        select: comparableSelect,
    });

    const snapshot = buildComparableReportSnapshot(comparables);

    const report = await prisma.report.update({
        where: { id: reportId },
        data: { comparablesJson: snapshot },
        select: { id: true, comparablesJson: true },
    });

    return {
        reportId: report.id,
        comparablesJson: report.comparablesJson,
    };
}

export default snapshotReportComparables;

