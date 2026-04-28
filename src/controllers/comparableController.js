import { badRequest } from "../utils/errors.js";
import {
    getReportComparableListings,
    searchComparablesForReport,
    setComparableSelected,
    updateComparableListing,
    verifyComparableListing,
} from "../services/comparableSearchService.js";
import { importComparablesFromCsv } from "../services/comparableImportService.js";
import { selectBestComparableListings } from "../services/comparableSelectionService.js";
import { snapshotReportComparables as snapshotReportComparablesService } from "../services/comparableReportSnapshotService.js";

function userIdFromReq(req) {
    const userId = req.user?.userId;
    if (!userId) throw badRequest("Kullanıcı bilgisi bulunamadı.");
    return userId;
}

export const searchComparables = async (req, res) => {
    const result = await searchComparablesForReport(userIdFromReq(req), req.body || {});
    res.status(201).json(result);
};

export const getReportComparables = async (req, res) => {
    const comparables = await getReportComparableListings(userIdFromReq(req), req.params.reportId);
    res.json({ comparables });
};

export const updateComparable = async (req, res) => {
    const comparable = await updateComparableListing(userIdFromReq(req), req.params.id, req.body || {});
    res.json({ comparable });
};

export const verifyComparable = async (req, res) => {
    const comparable = await verifyComparableListing(userIdFromReq(req), req.params.id);
    res.json({ comparable });
};

export const selectComparable = async (req, res) => {
    const comparable = await setComparableSelected(userIdFromReq(req), req.params.id, true);
    res.json({ comparable });
};

export const unselectComparable = async (req, res) => {
    const comparable = await setComparableSelected(userIdFromReq(req), req.params.id, false);
    res.json({ comparable });
};

export const selectBestForReport = async (req, res) => {
    const result = await selectBestComparableListings(userIdFromReq(req), req.params.reportId);
    res.json(result);
};

export const snapshotReportComparables = async (req, res) => {
    const result = await snapshotReportComparablesService(userIdFromReq(req), req.params.reportId);
    res.json(result);
};

export const importCsv = async (req, res) => {
    const result = await importComparablesFromCsv(userIdFromReq(req), req.file, req.body || {});
    res.status(201).json(result);
};
