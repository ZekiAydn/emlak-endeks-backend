import * as cheerio from "cheerio";
import prisma from "../prisma.js";
import { normalizePropertyText } from "./propertyCategory.js";

const NUFUSUNE_BASE_URL = "https://www.nufusune.com";
const USER_AGENT = "emlak-endeks-open-location-data/1.0";

export const FREE_LOCATION_DATA_SOURCES = [
    {
        id: "TUIK_MEDAS_ADNKS_KN95",
        name: "TUIK MEDAS ADNKS Belediye, koy ve mahalle nufuslari",
        url: "https://biruni.tuik.gov.tr/medas/?kn=95&locale=tr",
        level: "NEIGHBORHOOD",
        status: "official_research_source",
        note: "Official neighborhood population source; ZK UI requires a separate automation adapter.",
    },
    {
        id: "TUIK_NIP",
        name: "TUIK Nufus Istatistikleri Portali",
        url: "https://nip.tuik.gov.tr/",
        level: "COUNTRY_PROVINCE",
        status: "official_import_candidate",
        note: "Open official Excel exports for population, household, education, building and housing indicators.",
    },
    {
        id: "NUFUSUNE",
        name: "nufusune.com",
        url: NUFUSUNE_BASE_URL,
        level: "NEIGHBORHOOD",
        status: "enabled_secondary_source",
        note: "Free public pages declare that data is taken from online TUIK population database; rows are stored as secondary/unverified.",
    },
];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function stripLocationWords(value) {
    return normalizePropertyText(value)
        .replace(/\b(mahalle|mahallesi|mah|mh|koyu|koy|belde|beldesi|ilce|ilcesi|nufusu)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function slugifyLocation(value) {
    return normalizePropertyText(value).replace(/\s+/g, "-");
}

function parseTrNumber(value) {
    const cleaned = String(value || "").replace(/[^\d-]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}

function absoluteNufusuneUrl(href) {
    if (!href) return null;
    try {
        return new URL(href, NUFUSUNE_BASE_URL).toString();
    } catch {
        return null;
    }
}

async function fetchHtml(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "user-agent": USER_AGENT,
            "accept": "text/html,application/xhtml+xml",
        },
    });

    if (!response.ok) {
        throw new Error(`${url} returned ${response.status}`);
    }

    const html = await response.text();
    if (!html || html.length < 200) {
        throw new Error(`${url} returned an empty response`);
    }

    if (options.delayMs) await sleep(options.delayMs);
    return html;
}

function inferYear($) {
    const text = normalizePropertyText($.root().text());
    const districtMatch = text.match(/\bilcesinin\s+(20\d{2})\s+ilce toplam nufusu\b/);
    if (districtMatch) return Number(districtMatch[1]);

    const years = [...text.matchAll(/\b(20\d{2})\b/g)]
        .map((match) => Number(match[1]))
        .filter((year) => Number.isFinite(year) && year >= 2007 && year <= 2100);

    return years.length ? Math.max(...years) : 0;
}

function metricRowsFromRecord(record) {
    const common = {
        source: record.source,
        sourceDataset: record.sourceDataset,
        sourceReliability: record.sourceReliability,
        declaredSource: record.declaredSource,
        sourceKey: record.sourceKey,
        sourceUrl: record.sourceUrl,
        locationLevel: record.locationLevel,
        country: "TR",
        city: record.city || null,
        district: record.district || null,
        neighborhood: record.neighborhood || null,
        normalizedCity: record.city ? stripLocationWords(record.city) : null,
        normalizedDistrict: record.district ? stripLocationWords(record.district) : null,
        normalizedNeighborhood: record.neighborhood ? stripLocationWords(record.neighborhood) : null,
        year: record.year || 0,
        rawJson: record.rawJson || null,
    };

    return Object.entries(record.metrics || {})
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([metricKey, metric]) => ({
            ...common,
            metricKey,
            metricLabel: metric.label || metricKey,
            metricValue: Number.isFinite(Number(metric.value)) ? Number(metric.value) : null,
            metricText: metric.text || null,
            unit: metric.unit || null,
        }));
}

export function parseNufusuneDistrictPage(html, options = {}) {
    const $ = cheerio.load(html);
    const city = cleanText(options.city || $("ul.breadcrumb a").eq(1).text().replace(/\s*N[UÜ]FUSU\s*/i, ""));
    const district = cleanText(options.district || $("h1#ust_baslik").text().split(",")[0].replace(/\s*N[UÜ]FUSU\s*/i, ""));
    const sourceUrl = options.sourceUrl || null;
    const year = inferYear($);
    const rows = [];

    const summary = {};
    $(".boxDetaylar li").each((_, item) => {
        const label = normalizePropertyText($(item).find(".dtColOne").text());
        const value = parseTrNumber($(item).find(".dtColTwo").text());
        if (label.includes("toplam nufus") && !label.includes("belde") && summary.populationTotal === undefined) summary.populationTotal = value;
        if (label.includes("toplam erkek nufusu")) summary.populationMale = value;
        if (label.includes("toplam kadin nufusu")) summary.populationFemale = value;
        if (label.includes("koye bagli") || label.includes("bagli koy sayisi")) summary.villageCount = value;
        if (label.includes("mahalle sayisi")) summary.neighborhoodCount = value;
    });

    if (summary.populationTotal !== undefined) {
        rows.push({
            source: "NUFUSUNE",
            sourceDataset: "population",
            sourceReliability: "secondary_tuik_declared_unverified",
            declaredSource: "TUIK online population database, declared by nufusune.com",
            sourceKey: `nufusune:${slugifyLocation(city)}:${slugifyLocation(district)}`,
            sourceUrl,
            locationLevel: "DISTRICT",
            city,
            district,
            year,
            metrics: {
                population_total: { label: "Population total", value: summary.populationTotal, unit: "person" },
                population_male: { label: "Population male", value: summary.populationMale, unit: "person" },
                population_female: { label: "Population female", value: summary.populationFemale, unit: "person" },
                neighborhood_count: { label: "Neighborhood count", value: summary.neighborhoodCount, unit: "count" },
                village_count: { label: "Village count", value: summary.villageCount, unit: "count" },
            },
            rawJson: { source: "nufusune", type: "district_summary", summary },
        });
    }

    const tableRows = $("#ust_tablo tr").length ? $("#ust_tablo tr") : $("td[data-label='MAHALLE ADI']").closest("tr");
    tableRows.each((_, row) => {
        const cells = $(row).find("td");
        const nameLink = $(row).find("td[data-label='MAHALLE ADI'] a").first();
        const neighborhood = cleanText(nameLink.text() || $(cells[0]).text());
        const href = nameLink.attr("href");
        const rowUrl = absoluteNufusuneUrl(href);
        const recordId = String(href || "").match(/^\/?(\d+)-/)?.[1] || null;
        const total = parseTrNumber($(row).find("td[data-label='TOPLAM NÜFUS']").text() || $(cells[1]).text());
        const male = parseTrNumber($(row).find("td[data-label='ERKEK NÜFUS']").text() || $(cells[2]).text());
        const female = parseTrNumber($(row).find("td[data-label='KADIN NÜFUS']").text() || $(cells[3]).text());

        if (!neighborhood || total === null) return;

        rows.push({
            source: "NUFUSUNE",
            sourceDataset: "population",
            sourceReliability: "secondary_tuik_declared_unverified",
            declaredSource: "TUIK online population database, declared by nufusune.com",
            sourceKey: `nufusune:${recordId || `${slugifyLocation(city)}:${slugifyLocation(district)}:${slugifyLocation(neighborhood)}`}`,
            sourceUrl: rowUrl || sourceUrl,
            locationLevel: "NEIGHBORHOOD",
            city,
            district,
            neighborhood,
            year,
            metrics: {
                population_total: { label: "Population total", value: total, unit: "person" },
                population_male: { label: "Population male", value: male, unit: "person" },
                population_female: { label: "Population female", value: female, unit: "person" },
            },
            rawJson: {
                source: "nufusune",
                type: "district_neighborhood_row",
                recordId,
                neighborhood,
                total,
                male,
                female,
            },
        });
    });

    return {
        source: "NUFUSUNE",
        sourceUrl,
        city,
        district,
        year,
        records: rows,
        metricRows: rows.flatMap(metricRowsFromRecord),
    };
}

export function parseNufusuneCityDistrictLinks(html, city) {
    const $ = cheerio.load(html);
    const citySlug = slugifyLocation(city);
    const seen = new Set();
    const districts = [];

    $(`a[href*="-ilce-nufusu-${citySlug}"]`).each((_, anchor) => {
        const href = $(anchor).attr("href");
        const url = absoluteNufusuneUrl(href);
        const text = cleanText($(anchor).text()).replace(/\s*N[UÜ]FUSU\s*$/i, "");
        const key = url || href;
        if (!url || !text || seen.has(key)) return;
        seen.add(key);
        districts.push({ city, district: text, url });
    });

    return districts;
}

export function parseNufusuneCityLinks(html) {
    const $ = cheerio.load(html);
    const seen = new Set();
    const cities = [];

    $("select option").each((_, option) => {
        const value = cleanText($(option).attr("value"));
        const name = cleanText($(option).text());
        if (!value || value === "0" || !value.endsWith("-nufusu") || seen.has(value)) return;
        seen.add(value);
        cities.push({ city: name, url: absoluteNufusuneUrl(value) });
    });

    return cities;
}

export async function saveOpenLocationMetricRows(metricRows = [], options = {}) {
    if (options.dryRun) {
        return { attempted: metricRows.length, saved: 0, dryRun: true };
    }

    if (!options.upsertExisting) {
        const result = await prisma.openLocationStat.createMany({
            data: metricRows,
            skipDuplicates: true,
        });

        return {
            attempted: metricRows.length,
            saved: result.count || 0,
            dryRun: false,
            mode: "insert_only_skip_duplicates",
        };
    }

    let saved = 0;
    for (const row of metricRows) {
        await prisma.openLocationStat.upsert({
            where: {
                source_sourceDataset_sourceKey_metricKey_year: {
                    source: row.source,
                    sourceDataset: row.sourceDataset,
                    sourceKey: row.sourceKey,
                    metricKey: row.metricKey,
                    year: row.year || 0,
                },
            },
            update: {
                sourceReliability: row.sourceReliability,
                sourceUrl: row.sourceUrl,
                declaredSource: row.declaredSource,
                locationLevel: row.locationLevel,
                country: row.country,
                city: row.city,
                district: row.district,
                neighborhood: row.neighborhood,
                normalizedCity: row.normalizedCity,
                normalizedDistrict: row.normalizedDistrict,
                normalizedNeighborhood: row.normalizedNeighborhood,
                metricLabel: row.metricLabel,
                metricValue: row.metricValue,
                metricText: row.metricText,
                unit: row.unit,
                rawJson: row.rawJson,
                fetchedAt: new Date(),
            },
            create: row,
        });
        saved += 1;
    }

    return { attempted: metricRows.length, saved, dryRun: false, mode: "upsert_existing" };
}

export async function importNufusuneDistrict(options = {}) {
    if (!options.city || !options.district) {
        throw new Error("city and district are required for nufusune district import");
    }

    const citySlug = slugifyLocation(options.city);
    const districtSlug = slugifyLocation(options.district);
    const url = options.url || `${NUFUSUNE_BASE_URL}/${districtSlug}-ilce-nufusu-${citySlug}`;
    const html = await fetchHtml(url, { delayMs: options.delayMs });
    const parsed = parseNufusuneDistrictPage(html, { city: options.city, district: options.district, sourceUrl: url });
    const persistence = await saveOpenLocationMetricRows(parsed.metricRows, options);

    return {
        source: "NUFUSUNE",
        city: parsed.city,
        district: parsed.district,
        year: parsed.year,
        sourceUrl: url,
        recordCount: parsed.records.length,
        metricRowCount: parsed.metricRows.length,
        persistence,
        sample: parsed.records.slice(0, 5),
    };
}

export async function importNufusuneCity(options = {}) {
    if (!options.city) throw new Error("city is required for nufusune city import");

    const citySlug = slugifyLocation(options.city);
    const url = options.url || `${NUFUSUNE_BASE_URL}/${citySlug}-nufusu`;
    const html = await fetchHtml(url, { delayMs: options.delayMs });
    let districts = parseNufusuneCityDistrictLinks(html, options.city);

    if (options.district) {
        const target = stripLocationWords(options.district);
        districts = districts.filter((item) => stripLocationWords(item.district) === target);
        if (!districts.length) {
            districts = [{ city: options.city, district: options.district, url: `${NUFUSUNE_BASE_URL}/${slugifyLocation(options.district)}-ilce-nufusu-${citySlug}` }];
        }
    }

    if (options.limitDistricts) districts = districts.slice(0, Number(options.limitDistricts));

    const results = [];
    for (const district of districts) {
        results.push(await importNufusuneDistrict({
            ...options,
            city: options.city,
            district: district.district,
            url: district.url,
        }));
    }

    return {
        source: "NUFUSUNE",
        city: options.city,
        sourceUrl: url,
        districtCount: districts.length,
        recordCount: results.reduce((sum, item) => sum + item.recordCount, 0),
        metricRowCount: results.reduce((sum, item) => sum + item.metricRowCount, 0),
        saved: results.reduce((sum, item) => sum + (item.persistence?.saved || 0), 0),
        dryRun: Boolean(options.dryRun),
        results,
    };
}

export async function importNufusuneAll(options = {}) {
    const html = await fetchHtml(NUFUSUNE_BASE_URL, { delayMs: options.delayMs });
    let cities = parseNufusuneCityLinks(html);
    if (options.limitCities) cities = cities.slice(0, Number(options.limitCities));

    const results = [];
    for (const city of cities) {
        results.push(await importNufusuneCity({
            ...options,
            city: city.city,
            url: city.url,
        }));
    }

    return {
        source: "NUFUSUNE",
        cityCount: cities.length,
        districtCount: results.reduce((sum, item) => sum + item.districtCount, 0),
        recordCount: results.reduce((sum, item) => sum + item.recordCount, 0),
        metricRowCount: results.reduce((sum, item) => sum + item.metricRowCount, 0),
        saved: results.reduce((sum, item) => sum + item.saved, 0),
        dryRun: Boolean(options.dryRun),
    };
}

export async function getOpenLocationProfile(query = {}) {
    const normalizedCity = query.city ? stripLocationWords(query.city) : null;
    const normalizedDistrict = query.district ? stripLocationWords(query.district) : null;
    const normalizedNeighborhood = query.neighborhood ? stripLocationWords(query.neighborhood) : null;
    const year = query.year ? Number(query.year) : null;

    const where = {};
    if (normalizedCity) where.normalizedCity = normalizedCity;
    if (normalizedDistrict) where.normalizedDistrict = normalizedDistrict;
    if (normalizedNeighborhood) where.normalizedNeighborhood = normalizedNeighborhood;
    if (Number.isFinite(year)) where.year = year;

    const rows = await prisma.openLocationStat.findMany({
        where,
        orderBy: [{ year: "desc" }, { source: "asc" }, { metricKey: "asc" }],
        take: Math.min(Number(query.take || 100), 500),
    });

    const metrics = {};
    rows.forEach((row) => {
        if (!metrics[row.metricKey]) {
            metrics[row.metricKey] = {
                value: row.metricValue,
                text: row.metricText,
                unit: row.unit,
                year: row.year || null,
                label: row.metricLabel,
                source: row.source,
                sourceReliability: row.sourceReliability,
                sourceUrl: row.sourceUrl,
            };
        }
    });

    return {
        query: {
            city: query.city || null,
            district: query.district || null,
            neighborhood: query.neighborhood || null,
            year: Number.isFinite(year) ? year : null,
        },
        count: rows.length,
        metrics,
        rows,
    };
}
