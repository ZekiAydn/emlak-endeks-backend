import CsvListingProvider from "../providers/csvListingProvider.js";
import { normalizeComparableListing } from "../helpers/normalizeComparableListing.js";
import { findReportForUser, buildCriteriaFromReportAndBody, saveComparableListings, toComparableDto } from "./comparableSearchService.js";
import { badRequest } from "../utils/errors.js";

function cleanString(value) {
    return String(value || "").trim();
}

function isValidHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return ["http:", "https:"].includes(parsed.protocol);
    } catch {
        return false;
    }
}

export async function importComparablesFromCsv(userId, file, body = {}) {
    if (!file?.buffer) {
        throw badRequest("CSV dosyası gerekli.", "file");
    }

    const reportId = cleanString(body.reportId);
    const report = await findReportForUser(userId, reportId);
    const context = buildCriteriaFromReportAndBody(body, report);
    const provider = new CsvListingProvider();
    const rows = provider.parse(file.buffer);
    const errors = [];

    const normalizedRows = rows
        .map((row, index) => {
            const normalized = normalizeComparableListing(
                {
                    ...row,
                    providerRaw: row,
                },
                { context }
            );

            if (!normalized.listingUrl || !isValidHttpUrl(normalized.listingUrl)) {
                errors.push({
                    row: index + 2,
                    reason: "listingUrl zorunlu ve geçerli URL olmalı.",
                });
                return null;
            }

            return normalized;
        })
        .filter(Boolean);

    const saved = await saveComparableListings({
        userId,
        reportId: reportId || undefined,
        comparables: normalizedRows,
    });

    return {
        totalRows: rows.length,
        imported: saved.length,
        errors,
        comparables: saved.map(toComparableDto),
    };
}

export default importComparablesFromCsv;
