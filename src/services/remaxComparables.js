const REMAX_BASE_URL = "https://remax.com.tr";
import { getBrowser } from "./headlessBrowser.js";

const REQUEST_HEADERS = {
    accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "cache-control": "no-cache",
    pragma: "no-cache",
    referer: `${REMAX_BASE_URL}/`,
    "upgrade-insecure-requests": "1",
    "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    "accept-language": "tr-TR,tr;q=0.9,en;q=0.8",
};

const ISTANBUL_ANADOLU_DISTRICTS = new Set([
    "adalar",
    "atasehir",
    "beykoz",
    "cekmekoy",
    "kadikoy",
    "kartal",
    "maltepe",
    "pendik",
    "sancaktepe",
    "sile",
    "sultanbeyli",
    "tuzla",
    "umraniye",
    "uskudar",
]);

function asciiTurkish(value) {
    return String(value || "")
        .replace(/İ/g, "i")
        .replace(/I/g, "i")
        .replace(/ı/g, "i")
        .replace(/ğ/g, "g")
        .replace(/Ğ/g, "G")
        .replace(/ü/g, "u")
        .replace(/Ü/g, "U")
        .replace(/ş/g, "s")
        .replace(/Ş/g, "S")
        .replace(/ö/g, "o")
        .replace(/Ö/g, "O")
        .replace(/ç/g, "c")
        .replace(/Ç/g, "C");
}

function normalizeText(value) {
    return asciiTurkish(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[']/g, "")
        .replace(/&/g, " ve ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function slugify(value) {
    return normalizeText(value).replace(/\s+/g, "-");
}

function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const normalized = String(value).replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function formatShortMoney(value) {
    const amount = toNumber(value);
    if (!Number.isFinite(amount)) return null;
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2).replace(".", ",")} Mn TL`;
    return `${Math.round(amount).toLocaleString("tr-TR")} TL`;
}

function localizedText(value) {
    if (Array.isArray(value)) {
        const tr = value.find((item) => Number(item?.languageId) === 1 && item?.text);
        return tr?.text || value.find((item) => item?.text)?.text || "";
    }
    return String(value || "");
}

function detectCitySlug(city, district) {
    const cityNorm = normalizeText(city);
    if (cityNorm.includes("istanbul")) {
        return ISTANBUL_ANADOLU_DISTRICTS.has(slugify(district)) ? "istanbul-anadolu" : "istanbul-avrupa";
    }
    return slugify(city);
}

function detectSubcategorySlug(propertyType) {
    const text = normalizeText(propertyType);
    if (!text) return "daire";
    if (text.includes("villa")) return "villa";
    if (text.includes("residence")) return "residence";
    if (text.includes("studyo")) return "studyo-daire";
    if (text.includes("dublex") || text.includes("dubleks")) return "dubleks";
    if (text.includes("triplex") || text.includes("tripleks")) return "tripleks";
    if (text.includes("müstakil") || text.includes("mustakil")) return "mustakil-ev";
    return "daire";
}

function detectCommercialSubcategorySlug(propertyType) {
    const text = normalizeText(propertyType);
    if (text.includes("dukkan") || text.includes("magaza")) return "dukkan-magaza";
    if (text.includes("depo")) return "depo";
    if (text.includes("plaza")) return "plaza";
    if (text.includes("fabrika")) return "fabrika";
    if (text.includes("otel")) return "otel";
    if (text.includes("ofis") || text.includes("büro") || text.includes("buro")) return "ofis";
    return "dukkan-magaza";
}

function detectLandSubcategorySlug(propertyType) {
    const text = normalizeText(propertyType);
    if (text.includes("ticari")) return "ticari";
    if (text.includes("tarla") || text.includes("tarim") || text.includes("tarım")) return "tarim";
    if (text.includes("bag") || text.includes("bahce") || text.includes("bahçe")) return "bag-bahce";
    if (text.includes("konut")) return "konut-imarli";
    return null;
}

function reportCategory(criteria) {
    const type = normalizeText(criteria.reportType);
    const propertyType = normalizeText(criteria.propertyType);

    if (type.includes("land") || type.includes("arsa") || propertyType.includes("arsa") || propertyType.includes("tarla")) {
        return "land";
    }
    if (type.includes("commercial") || type.includes("ticari") || propertyType.includes("ofis") || propertyType.includes("dukkan") || propertyType.includes("magaza")) {
        return "commercial";
    }
    return "residential";
}

function normalizeNeighborhoodQuery(neighborhood) {
    const base = normalizeText(neighborhood)
        .replace(/\bmahallesi\b/g, "")
        .replace(/\bmahalle\b/g, "")
        .replace(/\bmah\b/g, "")
        .trim();

    if (!base) return null;
    return `${base.replace(/\s+/g, "-")}-mah`;
}

function buildSearchUrl(criteria, { withNeighborhood = true, sort = "13,desc" } = {}) {
    const citySlug = detectCitySlug(criteria.city, criteria.district);
    const districtSlug = slugify(criteria.district);
    const category = reportCategory(criteria);
    const subcategorySlug =
        category === "commercial"
            ? detectCommercialSubcategorySlug(criteria.propertyType)
            : category === "land"
              ? detectLandSubcategorySlug(criteria.propertyType)
              : detectSubcategorySlug(criteria.propertyType);

    const path =
        category === "commercial"
            ? `/tr/ticari/satilik/${subcategorySlug}/${citySlug}/${districtSlug}`
            : category === "land"
              ? `/tr/arsa-arazi/satilik/${subcategorySlug ? `${subcategorySlug}/` : ""}${citySlug}/${districtSlug}`
              : `/tr/konut/satilik/${subcategorySlug}/${citySlug}/${districtSlug}`;
    const url = new URL(`${REMAX_BASE_URL}${path}`);
    url.searchParams.set("currencyId", "1");
    url.searchParams.set("view", "full-card");
    url.searchParams.set("sort", sort);

    const neighborhoodQuery = normalizeNeighborhoodQuery(criteria.neighborhood);
    if (withNeighborhood && neighborhoodQuery) {
        url.searchParams.set("neighborhoods", neighborhoodQuery);
    }

    return url.toString();
}

function extractJsonObject(text, token) {
    const idx = text.indexOf(token);
    if (idx < 0) return null;

    const start = text.indexOf("{", idx + token.length);
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
        const ch = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === "\"") {
                inString = false;
            }
            continue;
        }

        if (ch === "\"") {
            inString = true;
            continue;
        }

        if (ch === "{") depth += 1;
        if (ch === "}") {
            depth -= 1;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }

    return null;
}

function extractListingPayloadFromHtml(html) {
    const matches = html.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g);

    for (const match of matches) {
        try {
            const decoded = JSON.parse(`"${match[1]}"`);
            if (!decoded.includes("propertyListingData")) continue;

            const raw = extractJsonObject(decoded, 'propertyListingData":');
            if (!raw) continue;

            const parsed = JSON.parse(raw);
            if (parsed?.data?.data) return parsed.data;
        } catch (error) {
            continue;
        }
    }

    return null;
}

function parseSearchPage(url, html) {
    const payload = extractListingPayloadFromHtml(html);

    if (!payload) {
        const error = new Error("RE/MAX sayfasındaki ilan verisi ayrıştırılamadı.");
        error.code = "REMAX_PARSE_FAILED";
        throw error;
    }

    return {
        url,
        recordCount: toNumber(payload.recordCount),
        listings: Array.isArray(payload.data) ? payload.data : [],
    };
}

function shouldTryBrowserFallback(error) {
    if (!error) return false;
    if (error.code === "REMAX_PARSE_FAILED") return true;
    if (error.status === 403 || error.status === 429) return true;
    if (error.name === "TypeError") return true;
    return false;
}

async function fetchSearchPageWithBrowser(url) {
    const browser = await getBrowser();
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1200, deviceScaleFactor: 1 },
        locale: "tr-TR",
        userAgent: REQUEST_HEADERS["user-agent"],
        extraHTTPHeaders: {
            "accept-language": REQUEST_HEADERS["accept-language"],
            referer: `${REMAX_BASE_URL}/`,
        },
    });

    try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
        const status = response?.status();

        if (status && status >= 400) {
            const error = new Error(`RE/MAX araması cevap vermedi (${status})`);
            error.status = status;
            throw error;
        }

        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        return parseSearchPage(url, await page.content());
    } finally {
        await page.close().catch(() => {});
    }
}

async function fetchSearchPage(url) {
    let fetchError = null;
    let response = null;

    try {
        response = await fetch(url, {
            headers: REQUEST_HEADERS,
            cache: "no-store",
        });
    } catch (error) {
        fetchError = error;
    }

    if (response && !response.ok) {
        fetchError = new Error(`RE/MAX araması cevap vermedi (${response.status})`);
        fetchError.status = response.status;
    } else if (response) {
        const html = await response.text();

        try {
            return parseSearchPage(url, html);
        } catch (error) {
            fetchError = error;
        }
    }

    if (shouldTryBrowserFallback(fetchError)) {
        try {
            return await fetchSearchPageWithBrowser(url);
        } catch (browserError) {
            throw fetchError;
        }
    }

    throw fetchError;
}

function haversineMeters(a, b) {
    if (!a || !b) return null;

    const lat1 = Number(a.lat);
    const lon1 = Number(a.lon);
    const lat2 = Number(b.lat);
    const lon2 = Number(b.lon);

    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;

    const toRad = (value) => (value * Math.PI) / 180;
    const earthRadius = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const aa =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
    return Math.round(earthRadius * c);
}

function listingAgeDays(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const diffMs = Date.now() - date.getTime();
    return Math.max(0, Math.round(diffMs / 86400000));
}

function parseFloorNumber(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const match = text.match(/-?\d+/);
    if (match) {
        const parsed = Number(match[0]);
        return Number.isFinite(parsed) ? parsed : null;
    }
    const normalized = normalizeText(text);
    if (normalized.includes("giris")) return 0;
    return null;
}

function normalizeImageUrl(url) {
    const text = String(url || "").trim();
    if (!text) return null;
    return text.replace(/\.webp(\?.*)?$/i, ".jpg$1");
}

function areaFieldsFromListing(item) {
    const area = toNumber(item?.m2Area);
    const attr = normalizeText(item?.m2AreaAttributeName);

    if (!Number.isFinite(area)) {
        return { netArea: null, grossArea: null };
    }

    if (attr.includes("net")) return { netArea: area, grossArea: null };
    if (attr.includes("brut") || attr.includes("brüt")) return { netArea: null, grossArea: area };
    return { netArea: area, grossArea: null };
}

function comparableFromListing(item, subjectPoint) {
    const { netArea, grossArea } = areaFieldsFromListing(item);
    const lat = toNumber(item?.latitude);
    const lon = toNumber(item?.longitude);
    const price = toNumber(item?.priceInfo?.amount);
    const pricePerSqm = toNumber(item?.pricePerM2Amount);
    const createdAt = item?.createDate ? new Date(item.createDate).toISOString() : null;
    const floorText = item?.floor ? String(item.floor) : null;
    const roomText = item?.roomOptions ? String(item.roomOptions) : null;
    const externalId = item?.code || String(item?.id || "");
    const sourceUrl = externalId ? `${REMAX_BASE_URL}/tr/portfoy/${externalId}` : null;

    return {
        title: localizedText(item?.title) || item?.address || "RE/MAX İlanı",
        source: "RE/MAX",
        sourceUrl,
        price,
        netArea,
        grossArea,
        roomText,
        buildingAge: null,
        floor: parseFloorNumber(floorText),
        floorText,
        totalFloors: null,
        distanceMeters: haversineMeters(subjectPoint, { lat, lon }),
        listingAgeDays: listingAgeDays(item?.createDate),
        imageUrl: normalizeImageUrl(item?.images?.[0]),
        address: item?.address || null,
        externalId,
        createdAt,
        pricePerSqm,
        provider: "REMAX",
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lon) ? lon : null,
    };
}

function dedupeComparables(items) {
    const seen = new Set();
    const output = [];

    for (const item of items) {
        const key = item.externalId || item.sourceUrl || item.title;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        output.push(item);
    }

    return output;
}

function comparableArea(item) {
    return toNumber(item?.netArea) || toNumber(item?.grossArea) || null;
}

function comparableUnitPrice(item) {
    const direct = toNumber(item?.pricePerSqm);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const price = toNumber(item?.price);
    const area = comparableArea(item);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(area) || area <= 0) return null;
    return price / area;
}

function isLikelyTestListing(item) {
    const text = normalizeText(`${item?.title || ""} ${item?.address || ""}`);
    return text.includes("test") || text.includes("dikkate almayin");
}

function selectRelevantComparables(comparables, { subjectArea, subjectRoomText } = {}) {
    const area = toNumber(subjectArea);
    const room = normalizeText(subjectRoomText);
    const scored = comparables.map((item) => {
        let score = 0;

        if (room && normalizeText(item?.roomText) === room) score += 3;

        const areaValue = comparableArea(item);
        if (Number.isFinite(area) && area > 0 && Number.isFinite(areaValue) && areaValue > 0) {
            const ratio = areaValue / area;
            if (ratio >= 0.65 && ratio <= 1.5) score += 2;
            if (ratio >= 0.8 && ratio <= 1.25) score += 1;
        }

        const distance = toNumber(item?.distanceMeters);
        if (Number.isFinite(distance)) {
            if (distance <= 1500) score += 3;
            else if (distance <= 3000) score += 2;
            else if (distance <= 6000) score += 1;
        }

        return { item, score, distance: Number.isFinite(distance) ? distance : Number.MAX_SAFE_INTEGER };
    });

    const byBestScore = (a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.distance - b.distance;
    };

    const strong = scored
        .filter((entry) => entry.score >= (room ? 4 : 2))
        .sort(byBestScore)
        .map((entry) => entry.item);
    if (strong.length >= 12) return strong.slice(0, 36);

    const moderate = scored
        .filter((entry) => entry.score >= 1)
        .sort(byBestScore)
        .map((entry) => entry.item);

    if (moderate.length >= 8) return moderate.slice(0, 36);

    return comparables.slice(0, 36);
}

function trimOutlierComparables(comparables) {
    const withoutTests = comparables.filter((item) => {
        if (isLikelyTestListing(item)) return false;

        const price = toNumber(item?.price);
        const unit = comparableUnitPrice(item);

        if (Number.isFinite(price) && price < 250000) return false;
        if (Number.isFinite(unit) && unit < 5000) return false;

        return true;
    });
    const unitPrices = withoutTests.map(comparableUnitPrice).filter(Number.isFinite).sort((a, b) => a - b);

    if (unitPrices.length < 8) return withoutTests;

    const q1 = quantile(unitPrices, 0.25);
    const q3 = quantile(unitPrices, 0.75);
    const iqr = q3 - q1;
    const lower = Math.max(1, q1 - iqr * 1.5);
    const upper = q3 + iqr * 1.5;

    const filtered = withoutTests.filter((item) => {
        const unit = comparableUnitPrice(item);
        if (!Number.isFinite(unit)) return true;
        return unit >= lower && unit <= upper;
    });

    return filtered.length >= 8 ? filtered : withoutTests;
}

function chooseMidComparables(sortedItems, count, excludedKeys) {
    const candidates = sortedItems.filter((item) => !excludedKeys.has(item.externalId || item.sourceUrl));
    if (!candidates.length) return [];

    const start = Math.max(0, Math.floor(candidates.length / 2) - Math.floor(count / 2));
    return candidates.slice(start, start + count);
}

function buildGroups(comparables) {
    const priced = comparables
        .filter((item) => Number.isFinite(toNumber(item.price)))
        .slice()
        .sort((a, b) => toNumber(a.price) - toNumber(b.price));

    const low = priced.slice(0, 4);
    const high = priced.slice(Math.max(0, priced.length - 4));
    const used = new Set(
        [...low, ...high].map((item) => item.externalId || item.sourceUrl).filter(Boolean)
    );
    const mid = chooseMidComparables(priced, 4, used);

    return {
        low: low.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
        mid: mid.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
        high: high.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
    };
}

function orderComparablesForOutput(comparables, groups) {
    const byKey = new Map(
        comparables
            .map((item) => [item.externalId || item.sourceUrl, item])
            .filter(([key]) => !!key)
    );

    const ordered = [];
    const used = new Set();

    ["low", "mid", "high"].forEach((group) => {
        (groups?.[group] || []).forEach((key) => {
            const item = byKey.get(key);
            if (!item || used.has(key)) return;
            ordered.push(item);
            used.add(key);
        });
    });

    const remainder = comparables
        .filter((item) => {
            const key = item.externalId || item.sourceUrl;
            return key ? !used.has(key) : true;
        })
        .sort((a, b) => {
            const ageA = Number.isFinite(Number(a?.listingAgeDays)) ? Number(a.listingAgeDays) : Number.MAX_SAFE_INTEGER;
            const ageB = Number.isFinite(Number(b?.listingAgeDays)) ? Number(b.listingAgeDays) : Number.MAX_SAFE_INTEGER;
            return ageA - ageB;
        });

    return [...ordered, ...remainder].slice(0, 24);
}

function quantile(values, ratio) {
    const list = values.map(toNumber).filter(Number.isFinite).sort((a, b) => a - b);
    if (!list.length) return null;
    const pos = (list.length - 1) * ratio;
    const lower = Math.floor(pos);
    const upper = Math.ceil(pos);
    if (lower === upper) return list[lower];
    const weight = pos - lower;
    return list[lower] * (1 - weight) + list[upper] * weight;
}

function buildMarketProjection(comparables, totalCount) {
    const ages = comparables.map((item) => toNumber(item.listingAgeDays)).filter(Number.isFinite);
    const averageMarketingDays = ages.length
        ? Math.round(ages.reduce((sum, value) => sum + value, 0) / ages.length)
        : null;

    const waitingComparableCount = ages.filter((value) => value >= 90).length;
    const activeComparableCount = toNumber(totalCount) || comparables.length || null;

    let competitionStatus = "Düşük";
    if (activeComparableCount >= 80) competitionStatus = "Yüksek";
    else if (activeComparableCount >= 25) competitionStatus = "Orta";

    const summaryParts = [];
    if (activeComparableCount) {
        summaryParts.push(`RE/MAX havuzunda ${activeComparableCount} aktif emsal görüldü.`);
    }
    if (Number.isFinite(averageMarketingDays)) {
        summaryParts.push(`İlanların ortalama yayında kalma süresi yaklaşık ${averageMarketingDays} gün.`);
    }
    if (waitingComparableCount > 0) {
        summaryParts.push(`${waitingComparableCount} ilan uzun süredir yayında kaldığı için pazarlık payı artabilir.`);
    }

    return {
        averageMarketingDays,
        competitionStatus,
        activeComparableCount,
        waitingComparableCount,
        annualChangePct: null,
        amortizationYears: null,
        summary: summaryParts.join(" "),
        manualText: summaryParts.join(" "),
    };
}

function buildRegionalStats(criteria, comparables, parcelLookup, marketProjection) {
    const prices = comparables.map((item) => toNumber(item.price)).filter(Number.isFinite);
    const unitPrices = comparables
        .map((item) => {
            const area = toNumber(item.netArea) || toNumber(item.grossArea);
            if (!Number.isFinite(area) || area <= 0) return toNumber(item.pricePerSqm);
            return Math.round(toNumber(item.price) / area);
        })
        .filter(Number.isFinite);

    const locationBits = [criteria.neighborhood, criteria.district, criteria.city].filter(Boolean);
    const locationLabel = locationBits.join(" / ");
    const areaSummary = prices.length
        ? `İncelenen emsallerde fiyat bandı ${formatShortMoney(Math.min(...prices))} ile ${formatShortMoney(Math.max(...prices))} arasında.`
        : "";
    const unitSummary = unitPrices.length
        ? `Birim fiyatlar ${Math.round(Math.min(...unitPrices)).toLocaleString("tr-TR")} - ${Math.round(Math.max(...unitPrices)).toLocaleString("tr-TR")} TL/m² bandında.`
        : "";

    const parcelBits = [];
    if (parcelLookup?.properties?.summary) parcelBits.push(parcelLookup.properties.summary);
    if (parcelLookup?.properties?.quality) parcelBits.push(parcelLookup.properties.quality);
    if (parcelLookup?.properties?.area) parcelBits.push(`${parcelLookup.properties.area} m²`);

    const riskSummary =
        marketProjection?.waitingComparableCount > 0
            ? `Uzun süredir yayında kalan ilan sayısı ${marketProjection.waitingComparableCount}; doğru fiyat konumlandırması önem taşıyor.`
            : "Aktif ilan havuzu dengeli görünüyor; rekabet daha çok fiyat ve sunum kalitesinde yoğunlaşıyor.";

    return {
        demographicsSummary: locationLabel ? `${locationLabel} çevresindeki satılık konut havuzu üzerinden değerlendirme yapıldı.` : null,
        saleMarketSummary: [areaSummary, unitSummary].filter(Boolean).join(" "),
        rentalMarketSummary:
            Number.isFinite(marketProjection?.averageMarketingDays) && marketProjection.averageMarketingDays > 0
                ? `Aktif satış ilanlarının ortalama yayında kalma süresi ${marketProjection.averageMarketingDays} gün seviyesinde.`
                : null,
        nearbyPlacesSummary: parcelBits.length
            ? `Parsel doğrulaması ${parcelBits.join(" • ")} bilgileriyle desteklendi.`
            : null,
        riskSummary,
    };
}

function enrichComparablesWithGroups(comparables, groups) {
    const tagged = new Map();

    Object.entries(groups || {}).forEach(([group, ids]) => {
        (ids || []).forEach((id) => tagged.set(id, group));
    });

    return comparables.map((item) => ({
        ...item,
        group: tagged.get(item.externalId || item.sourceUrl) || item.group || null,
    }));
}

function buildPriceBandForSubject(comparables, subjectArea) {
    const area = toNumber(subjectArea);
    if (!Number.isFinite(area) || area <= 0) return null;

    const unitPrices = comparables
        .map((item) => {
            const comparableArea = toNumber(item.netArea) || toNumber(item.grossArea);
            if (!Number.isFinite(comparableArea) || comparableArea <= 0 || !Number.isFinite(toNumber(item.price))) return null;
            return toNumber(item.price) / comparableArea;
        })
        .filter(Number.isFinite);

    if (unitPrices.length < 3) return null;

    const minPricePerSqm = Math.round(quantile(unitPrices, 0.2));
    const expectedPricePerSqm = Math.round(quantile(unitPrices, 0.5));
    const maxPricePerSqm = Math.round(quantile(unitPrices, 0.8));

    if (![minPricePerSqm, expectedPricePerSqm, maxPricePerSqm].every(Number.isFinite)) return null;

    return {
        minPricePerSqm,
        expectedPricePerSqm,
        maxPricePerSqm,
        minPrice: Math.round(minPricePerSqm * area),
        expectedPrice: Math.round(expectedPricePerSqm * area),
        maxPrice: Math.round(maxPricePerSqm * area),
        confidence: Math.min(0.78, 0.52 + unitPrices.length * 0.01),
        note: `${comparables.length} RE/MAX emsalinin birim fiyat dağılımı üzerinden hesaplanan veri destekli fiyat bandıdır.`,
    };
}

async function fetchRemaxComparableBundle(criteria = {}, options = {}) {
    if (!criteria.city || !criteria.district) {
        return null;
    }

    const latestNeighborhoodUrl = buildSearchUrl(criteria, { withNeighborhood: true, sort: "13,desc" });
    const latestDistrictUrl = buildSearchUrl(criteria, { withNeighborhood: false, sort: "13,desc" });

    let latest = null;
    let scope = "district";

    if (criteria.neighborhood) {
        try {
            latest = await fetchSearchPage(latestNeighborhoodUrl);
            if ((latest.recordCount || 0) > 0) scope = "neighborhood";
        } catch (error) {
            latest = null;
        }
    }

    if (!latest || (latest.recordCount || 0) === 0) {
        latest = await fetchSearchPage(latestDistrictUrl);
        scope = "district";
    }

    if (!latest || !(latest.recordCount || latest.listings.length)) {
        return null;
    }

    const withNeighborhood = scope === "neighborhood";
    const [lowPage, highPage, oldPage] = await Promise.all([
        fetchSearchPage(buildSearchUrl(criteria, { withNeighborhood, sort: "4,asc" })),
        fetchSearchPage(buildSearchUrl(criteria, { withNeighborhood, sort: "4,desc" })),
        fetchSearchPage(buildSearchUrl(criteria, { withNeighborhood, sort: "10,asc" })),
    ]);

    const subjectPoint = options.subjectPoint || null;
    const merged = dedupeComparables(
        [...latest.listings, ...lowPage.listings, ...highPage.listings, ...oldPage.listings].map((item) =>
            comparableFromListing(item, subjectPoint)
        )
    );

    const analysisPool = selectRelevantComparables(merged, {
        subjectArea: options.subjectArea,
        subjectRoomText: options.subjectRoomText,
    });
    const presentationPool = trimOutlierComparables(analysisPool);
    const groups = buildGroups(presentationPool);
    const orderedComparables = orderComparablesForOutput(presentationPool, groups);
    const comparables = enrichComparablesWithGroups(orderedComparables, groups);
    const marketProjection = buildMarketProjection(presentationPool, latest.recordCount || highPage.recordCount || lowPage.recordCount);
    const regionalStats = buildRegionalStats(criteria, presentationPool, options.parcelLookup, marketProjection);
    const priceBand = buildPriceBandForSubject(
        presentationPool,
        options.subjectArea
    );

    return {
        comparables,
        groups,
        marketProjection,
        regionalStats,
        priceBand,
        sourceMeta: {
            provider: "RE/MAX",
            fetchedAt: new Date().toISOString(),
            scope,
            recordCount: latest.recordCount || highPage.recordCount || lowPage.recordCount || comparables.length,
            sampleCount: comparables.length,
            searchUrls: {
                latest: scope === "neighborhood" ? latestNeighborhoodUrl : latestDistrictUrl,
                low: buildSearchUrl(criteria, { withNeighborhood, sort: "4,asc" }),
                high: buildSearchUrl(criteria, { withNeighborhood, sort: "4,desc" }),
                oldest: buildSearchUrl(criteria, { withNeighborhood, sort: "10,asc" }),
            },
        },
    };
}

export {
    fetchRemaxComparableBundle,
};
