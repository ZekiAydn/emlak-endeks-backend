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

function pctChange(current, previous) {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
    return ((current - previous) / previous) * 100;
}

function housingIndexDerived(points = []) {
    const values = points.map((point) => Number(point.value)).filter(Number.isFinite);
    if (!values.length) return { metrics: null, yearlyChangePoints: [] };

    const latest = points[points.length - 1];
    const previous = points[points.length - 2];
    const yearBase = points.length > 12 ? points[points.length - 13] : null;
    const threeYearBase = points.length > 36 ? points[points.length - 37] : null;
    const first = points[0];
    const yearlyChangePoints = points
        .map((point, index) => {
            if (index < 12) return null;
            const changePct = pctChange(Number(point.value), Number(points[index - 12]?.value));
            return changePct === null ? null : { date: point.date, value: Number(changePct.toFixed(2)) };
        })
        .filter(Boolean);

    return {
        metrics: {
            latestDate: latest?.date || null,
            latestValue: Number(Number(latest?.value).toFixed(2)),
            previousMonthChangePct: pctChange(Number(latest?.value), Number(previous?.value)),
            annualChangePct: pctChange(Number(latest?.value), Number(yearBase?.value)),
            threeYearChangePct: pctChange(Number(latest?.value), Number(threeYearBase?.value)),
            periodChangePct: pctChange(Number(latest?.value), Number(first?.value)),
            minValue: Math.min(...values),
            maxValue: Math.max(...values),
        },
        yearlyChangePoints,
    };
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

    const endpoint = (process.env.TCMB_EVDS_ENDPOINT || "https://evds3.tcmb.gov.tr/igmevdsms-dis/").replace(/\/?$/, "/");
    const query = [
        `series=${encodeURIComponent(series)}`,
        `startDate=${encodeURIComponent(startDate)}`,
        `endDate=${encodeURIComponent(endDate)}`,
        "type=json",
        "formulas=",
        "frequency=5",
        "aggregationTypes=",
    ].join("&");
    const url = `${endpoint}${query}`;

    const response = await fetch(url, {
        cache: "no-store",
        headers: {
            accept: "application/json",
            key,
        },
    });
    if (!response.ok) throw new Error(`TCMB EVDS fetch failed: ${response.status} ${response.statusText}`);

    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (!contentType.includes("application/json")) {
        throw new Error(`TCMB EVDS JSON beklenirken ${contentType || "bilinmeyen içerik"} döndü.`);
    }

    const points = parseEvdsPoints(JSON.parse(text));
    if (points.length < 6) return null;

    const derived = housingIndexDerived(points);
    const value = {
        source: "TCMB EVDS",
        series,
        label: process.env.TCMB_HOUSING_INDEX_LABEL || "İstanbul Konut Fiyat Endeksi",
        points,
        metrics: derived.metrics,
        yearlyChangePoints: derived.yearlyChangePoints,
    };

    TCMB_CACHE.set(cacheKey, { value, expiresAt: now + 12 * 60 * 60 * 1000 });
    return value;
}
