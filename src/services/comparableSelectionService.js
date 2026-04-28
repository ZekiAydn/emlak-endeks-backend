import prisma from "../prisma.js";
import { selectBestComparablesForReport } from "../helpers/selectBestComparablesForReport.js";
import { findReportForUser, buildCriteriaFromReportAndBody, comparableSelect, toComparableDto } from "./comparableSearchService.js";

export async function selectBestComparableListings(userId, reportId) {
    const report = await findReportForUser(userId, reportId);
    const target = buildCriteriaFromReportAndBody({}, report);

    const comparables = await prisma.comparableListing.findMany({
        where: { userId, reportId },
        orderBy: [{ confidenceScore: "desc" }, { updatedAt: "desc" }],
        select: comparableSelect,
    });

    const result = selectBestComparablesForReport(comparables, target);

    await prisma.$transaction([
        prisma.comparableListing.updateMany({
            where: { userId, reportId },
            data: { isSelectedForReport: false, comparableGroup: null },
        }),
        ...result.selected.map((item) =>
            prisma.comparableListing.updateMany({
                where: { id: item.id, userId },
                data: {
                    isSelectedForReport: true,
                    comparableGroup: item.comparableGroup,
                    pricePerSqm: item.pricePerSqm,
                },
            })
        ),
    ]);

    const selectedIds = result.selected.map((item) => item.id);
    const selectedRecords = selectedIds.length
        ? await prisma.comparableListing.findMany({
            where: { userId, id: { in: selectedIds } },
            select: comparableSelect,
        })
        : [];
    const byId = new Map(selectedRecords.map((record) => [record.id, record]));

    return {
        selected: selectedIds.map((id) => toComparableDto(byId.get(id))).filter(Boolean),
        excluded: result.excluded,
        warnings: result.warnings,
        totalFound: comparables.length,
        totalUsable: result.totalUsable,
    };
}

export default selectBestComparableListings;

