const TCMB_CACHE = new Map();

function evdsDate(value) {
    const d = value ? new Date(value) : new Date();
    if (!Number.isFinite(d.getTime())) return null;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

function monthsAgo(value, count) {
    const d = value ? new Date(value) : new Date();
    if (!Number.isFinite(d.getTime())) return new Date();
    d.setMonth(d.getMonth() - count);
    return d;
}

function parseEvdsPoints(data) {
    return (Array.isArray(data?.items) ? data.items : [])
        .map((item) => {
            const date = item.Tarih || item.tarih || item.DATE || item.date;
            const valueKey = Object.keys(item).find((candidate) => !["Tarih", "tarih", "DATE", "date", "UNIXTIME"].includes(candidate));
            const value = Number(String(item[valueKey] || "").replace(",", "."));
            return date && Number.isFinite(value) ? { date, value } : null;
        })
        .filter(Boolean);
}

export async function fetchHousingIndexTrend(report = {}) {
    const key = process.env.TCMB_EVDS_API_KEY;
    const series = process.env.TCMB_HOUSING_INDEX_SERIES || "TP.KFE.TR10";
    if (!key || !series) return null;

    const reportDate = report.reportDate || report.createdAt || new Date().toISOString();
    const startDate = evdsDate(monthsAgo(reportDate, 48));
    const endDate = evdsDate(reportDate);
    if (!startDate || !endDate) return null;

    const cacheKey = `${series}:${startDate}:${endDate}`;
    const cached = TCMB_CACHE.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;

    const url = new URL("https://evds2.tcmb.gov.tr/service/evds/");
    url.searchParams.set("series", series);
    url.searchParams.set("startDate", startDate);
    url.searchParams.set("endDate", endDate);
    url.searchParams.set("type", "json");
    url.searchParams.set("key", key);

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`TCMB EVDS fetch failed: ${response.status} ${response.statusText}`);

    const points = parseEvdsPoints(await response.json());
    if (points.length < 6) return null;

    const value = {
        source: "TCMB EVDS",
        series,
        label: process.env.TCMB_HOUSING_INDEX_LABEL || "İstanbul Konut Fiyat Endeksi",
        points,
    };

    TCMB_CACHE.set(cacheKey, { value, expiresAt: now + 12 * 60 * 60 * 1000 });
    return value;
}
