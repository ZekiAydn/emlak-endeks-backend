import * as cheerio from "cheerio";
import { resolveHepsiemlakUrls, withSort } from "./hepsiemlakUrlResolver.js";
import { getBrowser } from "../headlessBrowser.js";

const HEPSIEMLAK_BASE_URL = "https://www.hepsiemlak.com";
const GROUP_SIZE = 6;
const MAX_OUTPUT_COMPARABLES = 24;

const REQUEST_HEADERS = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "cache-control": "no-cache",
    pragma: "no-cache",
    referer: `${HEPSIEMLAK_BASE_URL}/`,
    "upgrade-insecure-requests": "1",
    "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    "accept-language": "tr-TR,tr;q=0.9,en;q=0.8",
};

function asciiTurkish(value) {
    return String(value || "")
        .replace(/İ/g, "i")
        .replace(/I/g, "i")
        .replace(/ı/g, "i")
        .replace(/ğ/g, "g")
        .replace(/Ğ/g, "g")
        .replace(/ü/g, "u")
        .replace(/Ü/g, "u")
        .replace(/ş/g, "s")
        .replace(/Ş/g, "s")
        .replace(/ö/g, "o")
        .replace(/Ö/g, "o")
        .replace(/ç/g, "c")
        .replace(/Ç/g, "c");
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

function stripNeighborhoodSuffix(value) {
    return normalizeText(value)
        .replace(/\bmahallesi\b/g, "")
        .replace(/\bmahalle\b/g, "")
        .replace(/\bmah\b/g, "")
        .replace(/\bmh\b/g, "")
        .trim();
}

function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;

    const text = String(value)
        .replace(/\u00a0/g, " ")
        .replace(/₺/g, " TL")
        .trim();

    const match = text.match(/-?\d[\d.,]*/);
    if (!match) return null;

    const normalized = match[0]
        .replace(/\./g, "")
        .replace(",", ".")
        .replace(/[^\d.-]/g, "");

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function formatShortMoney(value) {
    const amount = toNumber(value);
    if (!Number.isFinite(amount)) return null;
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2).replace(".", ",")} Mn TL`;
    return `${Math.round(amount).toLocaleString("tr-TR")} TL`;
}

function absoluteUrl(href) {
    const text = String(href || "").trim();
    if (!text) return null;
    if (text.startsWith("http://") || text.startsWith("https://")) return text;
    if (text.startsWith("/")) return `${HEPSIEMLAK_BASE_URL}${text}`;
    return `${HEPSIEMLAK_BASE_URL}/${text}`;
}

function normalizeImageUrl(src) {
    const text = String(src || "").trim();
    if (!text || text.startsWith("data:")) return null;
    return absoluteUrl(text);
}

function cleanText(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .replace(/Telefonu Göster/gi, " ")
        .replace(/Mesaj/gi, " ")
        .replace(/Whatsapp/gi, " ")
        .replace(/Paylaş/gi, " ")
        .replace(/favori ikonu/gi, " ")
        .trim();
}

function extractByPatterns(text, patterns) {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return cleanText(match[1]);
    }

    return null;
}

function parseDateFromText(text) {
    const match = String(text || "").match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    if (!match) return null;

    const [, day, month, year] = match;
    const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;

    return date.toISOString();
}

function listingAgeDays(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Math.max(0, Math.round((Date.now() - date.getTime()) / 86400000));
}

function parseBuildingAge(value) {
    const text = String(value || "").trim();
    if (!text) return null;

    const normalized = normalizeText(text);
    if (normalized.includes("sifir")) return 0;

    const match = text.match(/\d+/);
    if (!match) return null;

    const n = Number(match[0]);
    return Number.isFinite(n) ? n : null;
}

function parseFloorNumber(value) {
    const text = String(value || "").trim();
    if (!text) return null;

    const match = text.match(/-?\d+/);
    if (match) {
        const n = Number(match[0]);
        return Number.isFinite(n) ? n : null;
    }

    const normalized = normalizeText(text);
    if (normalized.includes("giris")) return 0;
    if (normalized.includes("zemin")) return 0;
    if (normalized.includes("bahce")) return 0;

    return null;
}

function isLikelyListingHref(href) {
    const text = String(href || "");
    const lower = text.toLowerCase();

    if (!text) return false;
    if (lower.includes("/emlak-ofisi")) return false;
    if (lower.includes("/projeler")) return false;
    if (lower.includes("/harita")) return false;
    if (lower.includes("#")) return false;

    return (
        lower.includes("-satilik") ||
        lower.includes("satilik-") ||
        lower.includes("-kiralik") ||
        lower.includes("kiralik-") ||
        lower.includes("/daire") ||
        lower.includes("/villa") ||
        lower.includes("/arsa") ||
        lower.includes("/isyeri") ||
        lower.includes("/residence")
    );
}

function extractExternalId(url) {
    const text = String(url || "");
    const matches = text.match(/(\d{6,})/g);
    return matches?.length ? matches[matches.length - 1] : text;
}

function parseLocation(text, criteria = {}) {
    const normalized = cleanText(text);

    const directMatch = normalized.match(
        /([A-ZÇĞİÖŞÜa-zçğıöşü\s]+)\s*\/\s*([A-ZÇĞİÖŞÜa-zçğıöşü\s]+)\s*\/\s*([A-ZÇĞİÖŞÜa-zçğıöşü\s.]+Mah\.?)/
    );

    if (directMatch) {
        return `${directMatch[1].trim()} / ${directMatch[2].trim()} / ${directMatch[3].trim()}`;
    }

    const parts = [criteria.city, criteria.district, criteria.neighborhood].filter(Boolean);
    return parts.length ? parts.join(" / ") : null;
}

function scoreCardCandidate($, element) {
    const text = cleanText($(element).text());
    let score = 0;

    if (/\d[\d.]*\s*TL/i.test(text)) score += 3;
    if (/Oda Sayısı/i.test(text)) score += 2;
    if (/Brüt\s*m²/i.test(text)) score += 2;
    if (/Bina Yaşı/i.test(text)) score += 1;
    if (/Kat/i.test(text)) score += 1;
    if ($(element).find("a[href]").length) score += 1;

    return score;
}

function findListingCards($) {
    const selectors = [
        "li",
        "article",
        ".listing-item",
        ".list-view-content",
        ".links_listing",
        "[class*='listing']",
        "[class*='Listing']",
        "[class*='card']",
        "[class*='Card']",
    ];

    const cards = [];
    const seen = new Set();

    for (const selector of selectors) {
        $(selector).each((_, element) => {
            const text = cleanText($(element).text());
            if (!text || text.length < 80) return;
            if (!/\d[\d.]*\s*TL/i.test(text)) return;

            const href = $(element)
                .find("a[href]")
                .map((__, a) => $(a).attr("href"))
                .get()
                .find(isLikelyListingHref);

            if (!href) return;

            const key = href || text.slice(0, 120);
            if (seen.has(key)) return;

            const score = scoreCardCandidate($, element);
            if (score < 5) return;

            seen.add(key);
            cards.push(element);
        });
    }

    return cards;
}

function parseCard($, element, criteria = {}) {
    const $el = $(element);
    const text = cleanText($el.text());

    const href = $el
        .find("a[href]")
        .map((_, a) => $(a).attr("href"))
        .get()
        .find(isLikelyListingHref);

    const sourceUrl = absoluteUrl(href);

    const imageUrl = normalizeImageUrl(
        $el.find("img").first().attr("src") ||
        $el.find("img").first().attr("data-src") ||
        $el.find("img").first().attr("data-original")
    );

    const priceText = extractByPatterns(text, [
        /(\d[\d.]*\s*TL)/i,
        /(\d[\d.,]*\s*₺)/i,
    ]);

    const roomText = extractByPatterns(text, [
        /Oda Sayısı\s*([0-9]+\s*\+\s*[0-9]+)/i,
        /\b([0-9]+\s*\+\s*[0-9]+)\b/i,
    ]);

    const grossAreaText = extractByPatterns(text, [
        /Brüt\s*m²\s*([0-9.,]+)/i,
        /Brüt\s*m2\s*([0-9.,]+)/i,
        /\b([0-9.,]+)\s*m²\b/i,
        /\b([0-9.,]+)\s*m2\b/i,
    ]);

    const buildingAgeText = extractByPatterns(text, [
        /Bina Yaşı\s*(Sıfır Bina|[0-9]+\s*Yaşında|[0-9]+|Belirtilmemiş)/i,
    ]);

    const floorText = extractByPatterns(text, [
        /Kat\s*(Bahçe Katı|Zemin Kat|Giriş Katı|Yüksek Giriş|Ara Kat|En Üst Kat|Çatı Katı|[0-9.-]+\s*\.?\s*Kat)/i,
    ]);

    const createdAt = parseDateFromText(text);

    const titleCandidates = $el
        .find("a[href], h2, h3, h4")
        .map((_, node) => cleanText($(node).text()))
        .get()
        .filter((value) => {
            if (!value) return false;
            if (/\d[\d.]*\s*TL/i.test(value)) return false;
            if (/Telefonu Göster|Mesaj|Whatsapp|Paylaş/i.test(value)) return false;
            return value.length >= 12;
        });

    const title = titleCandidates.sort((a, b) => b.length - a.length)[0] || "Hepsiemlak İlanı";

    const price = toNumber(priceText);
    const grossArea = toNumber(grossAreaText);
    const netArea = null;

    const pricePerSqm =
        Number.isFinite(price) && Number.isFinite(grossArea) && grossArea > 0
            ? Math.round(price / grossArea)
            : null;

    return {
        title,
        source: "Hepsiemlak",
        sourceUrl,
        price,
        netArea,
        grossArea,
        roomText,
        buildingAge: parseBuildingAge(buildingAgeText),
        floor: parseFloorNumber(floorText),
        floorText: floorText || null,
        totalFloors: null,
        distanceMeters: null,
        listingAgeDays: listingAgeDays(createdAt),
        imageUrl,
        address: parseLocation(text, criteria),
        externalId: extractExternalId(sourceUrl),
        createdAt,
        pricePerSqm,
        provider: "HEPSIEMLAK",
        latitude: null,
        longitude: null,
    };
}

function firstString(...values) {
    return values.map((value) => cleanText(value)).find(Boolean) || null;
}

function collectObjects(value, output = []) {
    if (!value || typeof value !== "object") return output;

    if (Array.isArray(value)) {
        value.forEach((item) => collectObjects(item, output));
        return output;
    }

    output.push(value);
    Object.values(value).forEach((item) => collectObjects(item, output));
    return output;
}

function normalizeScriptComparable(item, criteria = {}) {
    const offer = item.offers || item.offer || {};
    const address =
        typeof item.address === "object"
            ? [item.address.addressLocality, item.address.addressRegion, item.address.streetAddress]
                  .filter(Boolean)
                  .join(" / ")
            : item.address;
    const floorSize = item.floorSize || item.size || item.area || {};
    const sourceUrl = absoluteUrl(item.url || item.href || item.link);
    const price = toNumber(offer.price || item.price || item.priceValue);
    const grossArea = toNumber(
        floorSize.value ||
            floorSize.area ||
            item.grossArea ||
            item.netArea ||
            item.areaGross ||
            item.area
    );

    if (!sourceUrl || !Number.isFinite(price) || !Number.isFinite(grossArea)) return null;

    return {
        title: firstString(item.name, item.title, item.description) || "Hepsiemlak İlanı",
        source: "Hepsiemlak",
        sourceUrl,
        price,
        netArea: null,
        grossArea,
        roomText: firstString(item.numberOfRooms, item.rooms, item.roomText),
        buildingAge: parseBuildingAge(item.buildingAge || item.age),
        floor: parseFloorNumber(item.floor || item.floorText),
        floorText: firstString(item.floorText, item.floor),
        totalFloors: toNumber(item.totalFloors),
        distanceMeters: null,
        listingAgeDays: listingAgeDays(item.datePosted || item.createdAt),
        imageUrl: normalizeImageUrl(Array.isArray(item.image) ? item.image[0] : item.image),
        address: firstString(address, parseLocation("", criteria)),
        externalId: extractExternalId(sourceUrl),
        createdAt: item.datePosted || item.createdAt || null,
        pricePerSqm: Math.round(price / grossArea),
        provider: "HEPSIEMLAK",
        latitude: toNumber(item.latitude),
        longitude: toNumber(item.longitude),
    };
}

function parseJsonLikeScript(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return null;

    const candidates = [];
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        candidates.push(trimmed);
    } else {
        const match = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (match?.[1]) candidates.push(match[1]);
    }

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            // continue with other script candidates
        }
    }

    return null;
}

function parseScriptComparables($, criteria = {}) {
    const comparables = [];

    $("script[type='application/ld+json'], script#__NEXT_DATA__, script").each((_, node) => {
        const json = parseJsonLikeScript($(node).text());
        if (!json) return;

        const objects = collectObjects(json);
        for (const item of objects) {
            const comparable = normalizeScriptComparable(item, criteria);
            if (comparable) comparables.push(comparable);
        }
    });

    return dedupeComparables(comparables);
}

function dedupeComparables(items) {
    const seen = new Set();
    const output = [];

    for (const item of items) {
        const key = item.externalId || item.sourceUrl || `${item.title}-${item.price}-${item.grossArea}`;
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

function trimOutlierComparables(comparables) {
    const clean = comparables.filter((item) => {
        if (isLikelyTestListing(item)) return false;

        const price = toNumber(item.price);
        const unit = comparableUnitPrice(item);
        const area = comparableArea(item);

        if (!Number.isFinite(price) || price < 250000) return false;
        if (!Number.isFinite(area) || area <= 10) return false;
        if (Number.isFinite(unit) && unit < 5000) return false;

        return true;
    });

    if (!clean.length && comparables.length) return comparables.filter((item) => !isLikelyTestListing(item));

    const units = clean.map(comparableUnitPrice).filter(Number.isFinite).sort((a, b) => a - b);
    if (units.length < 8) return clean;

    const q1 = quantile(units, 0.25);
    const q3 = quantile(units, 0.75);
    const iqr = q3 - q1;
    const lower = Math.max(1, q1 - iqr * 1.5);
    const upper = q3 + iqr * 1.5;

    const filtered = clean.filter((item) => {
        const unit = comparableUnitPrice(item);
        if (!Number.isFinite(unit)) return true;
        return unit >= lower && unit <= upper;
    });

    return filtered.length >= 6 ? filtered : clean;
}

function matchesNeighborhood(item, criteria = {}) {
    const neighborhood = stripNeighborhoodSuffix(criteria.neighborhood);
    if (!neighborhood) return true;

    const haystack = normalizeText(`${item?.address || ""} ${item?.title || ""} ${item?.sourceUrl || ""}`);
    const needle = normalizeText(neighborhood);

    if (!needle) return true;
    if (haystack.includes(needle)) return true;

    return haystack.replace(/\s+/g, "").includes(needle.replace(/\s+/g, ""));
}

function selectRelevantHepsiemlakComparables(items, criteria = {}) {
    const unique = dedupeComparables(items);

    if (!criteria.neighborhood) return unique;

    const neighborhoodMatches = unique.filter((item) => matchesNeighborhood(item, criteria));

    if (neighborhoodMatches.length >= 3) return neighborhoodMatches;

    return unique;
}

function roomMatches(itemRoom, targetRoom) {
    const current = normalizeText(itemRoom).replace(/\s+/g, "");
    const target = normalizeText(targetRoom).replace(/\s+/g, "");
    return !!current && !!target && current === target;
}

function preferTargetRoom(items, subjectRoomText) {
    const target = String(subjectRoomText || "").trim();
    if (!target) return items;

    const exact = items.filter((item) => roomMatches(item.roomText, target));
    if (exact.length >= 8) return exact;

    const withoutStudio = items.filter((item) => !/stüdyo|studio|1\+0/i.test(String(item.roomText || "")));
    if (/^[2-9]\+/.test(target) && withoutStudio.length >= 8) return withoutStudio;

    return items;
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

    const low = priced.slice(0, GROUP_SIZE);
    const high = priced.length <= GROUP_SIZE ? [] : priced.slice(Math.max(GROUP_SIZE, priced.length - GROUP_SIZE));
    const used = new Set([...low, ...high].map((item) => item.externalId || item.sourceUrl).filter(Boolean));
    const mid = chooseMidComparables(priced, GROUP_SIZE, used);
    const stale = comparables
        .filter((item) => Number.isFinite(toNumber(item?.listingAgeDays)))
        .slice()
        .sort((a, b) => toNumber(b.listingAgeDays) - toNumber(a.listingAgeDays))
        .slice(0, GROUP_SIZE);

    return {
        low: low.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
        mid: mid.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
        high: high.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
        stale: stale.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
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

function orderComparablesForOutput(comparables, groups) {
    const byKey = new Map(
        comparables
            .map((item) => [item.externalId || item.sourceUrl, item])
            .filter(([key]) => !!key)
    );
    const ordered = [];
    const used = new Set();

    ["low", "mid", "high", "stale"].forEach((group) => {
        (groups?.[group] || []).forEach((key) => {
            const item = byKey.get(key);
            if (!item || used.has(key)) return;
            ordered.push(item);
            used.add(key);
        });
    });

    const remainder = comparables.filter((item) => {
        const key = item.externalId || item.sourceUrl;
        return key ? !used.has(key) : true;
    });

    return [...ordered, ...remainder].slice(0, MAX_OUTPUT_COMPARABLES);
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
        summaryParts.push(`Hepsiemlak havuzunda ${activeComparableCount} aktif emsal örneği değerlendirildi.`);
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
    const unitPrices = comparables.map(comparableUnitPrice).filter(Number.isFinite);

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

    return {
        demographicsSummary: locationLabel ? `${locationLabel} çevresindeki satılık ilan havuzu üzerinden değerlendirme yapıldı.` : null,
        saleMarketSummary: [areaSummary, unitSummary].filter(Boolean).join(" "),
        rentalMarketSummary:
            Number.isFinite(marketProjection?.averageMarketingDays) && marketProjection.averageMarketingDays > 0
                ? `Aktif satış ilanlarının ortalama yayında kalma süresi ${marketProjection.averageMarketingDays} gün seviyesinde.`
                : null,
        nearbyPlacesSummary: parcelBits.length
            ? `Parsel doğrulaması ${parcelBits.join(" • ")} bilgileriyle desteklendi.`
            : null,
        riskSummary:
            marketProjection?.waitingComparableCount > 0
                ? `Uzun süredir yayında kalan ilan sayısı ${marketProjection.waitingComparableCount}; doğru fiyat konumlandırması önem taşıyor.`
                : "Aktif ilan havuzu dengeli görünüyor; rekabet daha çok fiyat ve sunum kalitesinde yoğunlaşıyor.",
    };
}

function buildPriceBandForSubject(comparables, subjectArea) {
    const area = toNumber(subjectArea);
    if (!Number.isFinite(area) || area <= 0) return null;

    const unitPrices = comparables.map(comparableUnitPrice).filter(Number.isFinite);
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
        confidence: Math.min(0.76, 0.5 + unitPrices.length * 0.01),
        note: `${comparables.length} Hepsiemlak emsalinin birim fiyat dağılımı üzerinden hesaplanan veri destekli fiyat bandıdır.`,
    };
}

async function fetchHtml(url, options = {}) {
    const timeoutMs = Number(process.env.HEPSIEMLAK_TIMEOUT_MS || 25000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        console.log("[HEPSIEMLAK] fetch", { url });

        const response = await fetch(url, {
            headers: REQUEST_HEADERS,
            cache: "no-store",
            signal: controller.signal,
        });

        const contentType = response.headers.get("content-type");
        const html = await response.text().catch(() => "");

        console.log("[HEPSIEMLAK] response", {
            url,
            status: response.status,
            ok: response.ok,
            contentType,
            size: html.length,
        });

        const result = {
            url,
            status: response.status,
            ok: response.ok,
            contentType,
            html,
            htmlLength: html.length,
            bodyStart: html.slice(0, 500),
        };

        if (!response.ok) {
            if (process.env.ENABLE_BROWSER_FALLBACK === "true" && process.env.HEPSIEMLAK_BROWSER_FALLBACK_ENABLED !== "false") {
                return fetchHtmlWithBrowser(url, options, result);
            }

            const error = new Error(`Hepsiemlak araması cevap vermedi (${response.status}): ${html.slice(0, 300)}`);
            error.fetchResult = result;
            throw error;
        }

        if (!html || html.length < 1000) {
            if (process.env.ENABLE_BROWSER_FALLBACK === "true" && process.env.HEPSIEMLAK_BROWSER_FALLBACK_ENABLED !== "false") {
                return fetchHtmlWithBrowser(url, options, result);
            }

            const error = new Error(`Hepsiemlak aramasından beklenen HTML alınamadı. Uzunluk: ${html.length}`);
            error.fetchResult = result;
            throw error;
        }

        return options.includeMeta ? result : html;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchHtmlWithBrowser(url, options = {}, directResult = {}) {
    console.log("[HEPSIEMLAK] browser fallback", {
        url,
        directStatus: directResult.status || null,
        directHtmlLength: directResult.htmlLength || 0,
    });

    const browser = await getBrowser();
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1200, deviceScaleFactor: 1 },
        locale: "tr-TR",
        userAgent: REQUEST_HEADERS["user-agent"],
        extraHTTPHeaders: {
            "accept-language": REQUEST_HEADERS["accept-language"],
            referer: `${HEPSIEMLAK_BASE_URL}/`,
        },
    });

    try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

        const status = response?.status() || null;
        const html = await page.content();
        const result = {
            url,
            status: status || 200,
            ok: !status || status < 400,
            contentType: response?.headers()?.["content-type"] || "text/html",
            html,
            htmlLength: html.length,
            bodyStart: html.slice(0, 500),
            browserFallback: true,
            directStatus: directResult.status || null,
            directBodyStart: directResult.bodyStart || null,
        };

        console.log("[HEPSIEMLAK] browser response", {
            url,
            status,
            ok: result.ok,
            size: html.length,
            title: cleanText(await page.title()).slice(0, 120),
        });

        if (!result.ok) {
            const error = new Error(`Hepsiemlak browser fallback cevap vermedi (${status}): ${html.slice(0, 300)}`);
            error.fetchResult = result;
            throw error;
        }

        if (!html || html.length < 1000) {
            const error = new Error(`Hepsiemlak browser fallback beklenen HTML'i alamadı. Uzunluk: ${html.length}`);
            error.fetchResult = result;
            throw error;
        }

        return options.includeMeta ? result : html;
    } finally {
        await page.close().catch(() => {});
    }
}

function parseSearchPage(url, html, criteria = {}, options = {}) {
    const $ = cheerio.load(html);
    const scriptComparables = parseScriptComparables($, criteria);
    const cards = findListingCards($);

    const comparables = dedupeComparables(
        [
            ...scriptComparables,
            ...cards
            .map((card) => parseCard($, card, criteria))
            .filter((item) => {
                if (!item?.sourceUrl) return false;
                if (!Number.isFinite(toNumber(item.price))) return false;
                if (!Number.isFinite(toNumber(item.netArea) || toNumber(item.grossArea))) return false;
                return true;
            }),
        ]
    );

    console.log("[HEPSIEMLAK] parsed", {
        url,
        cards: cards.length,
        comparables: comparables.length,
    });

    if (!cards.length && !scriptComparables.length) {
        console.warn("[HEPSIEMLAK] no cards", {
            url,
            title: cleanText($("title").first().text()).slice(0, 200),
            bodyStart: cleanText($("body").text()).slice(0, 300),
        });
    }

    if (options.includeDiagnostics) {
        return {
            title: cleanText($("title").first().text()),
            cardsCount: cards.length + scriptComparables.length,
            comparables,
            bodyStart: html.slice(0, 500),
        };
    }

    return comparables;
}

async function fetchFirstWorkingCandidate(criteria, sortOptions = {}, options = {}) {
    const candidates = Array.isArray(options.urls) && options.urls.length
        ? options.urls
        : await resolveHepsiemlakUrls(criteria, sortOptions);
    const errors = [];

    for (const url of candidates) {
        try {
            const html = await fetchHtml(url);
            const comparables = parseSearchPage(url, html, criteria);

            if (comparables.length > 0) {
                return {
                    url,
                    comparables,
                    errors,
                };
            }

            errors.push(`${url}: emsal bulunamadı`);
        } catch (error) {
            errors.push(`${url}: ${String(error.message || error)}`);
        }
    }

    return {
        url: candidates[0] || null,
        comparables: [],
        errors,
    };
}

async function fetchHepsiemlakHtmlComparableBundle(criteria = {}, options = {}) {
    if (!criteria.city && !criteria.district && !criteria.neighborhood) return null;

    const maxItems = Math.min(Number(process.env.HEPSIEMLAK_MAX_ITEMS || 36), 60);

    const latest = await fetchFirstWorkingCandidate(criteria);
    const defaultBaseUrls = latest.url && latest.comparables?.length ? [latest.url] : null;
    const low = await fetchFirstWorkingCandidate(
        criteria,
        { sortField: "PRICE", sortDirection: "ASC" },
        defaultBaseUrls ? { urls: defaultBaseUrls.map((url) => withSort(url, "PRICE", "ASC")) } : {}
    );
    const high = await fetchFirstWorkingCandidate(
        criteria,
        { sortField: "PRICE", sortDirection: "DESC" },
        defaultBaseUrls ? { urls: defaultBaseUrls.map((url) => withSort(url, "PRICE", "DESC")) } : {}
    );

    const allErrors = [
        ...(latest.errors || []),
        ...(low.errors || []),
        ...(high.errors || []),
    ];

    const rawComparables = preferTargetRoom(selectRelevantHepsiemlakComparables(
        [
            ...(latest.comparables || []),
            ...(low.comparables || []),
            ...(high.comparables || []),
        ],
        criteria
    ), options.subjectRoomText);

    const presentationPool = trimOutlierComparables(rawComparables).slice(0, maxItems);

    console.log("[HEPSIEMLAK] bundle", {
        latestUrl: latest.url,
        lowUrl: low.url,
        highUrl: high.url,
        rawCount: rawComparables.length,
        presentationCount: presentationPool.length,
        errors: allErrors.slice(0, 5),
    });

    if (!presentationPool.length) {
        const error = new Error(allErrors[0] || "Hepsiemlak aramasında emsal bulunamadı.");
        error.code = "HEPSIEMLAK_EMPTY";
        throw error;
    }

    const groups = buildGroups(presentationPool);
    const comparables = enrichComparablesWithGroups(orderComparablesForOutput(presentationPool, groups), groups);
    const marketProjection = buildMarketProjection(presentationPool, rawComparables.length);
    const regionalStats = buildRegionalStats(criteria, presentationPool, options.parcelLookup, marketProjection);
    const priceBand = buildPriceBandForSubject(presentationPool, options.subjectArea);

    return {
        comparables,
        groups,
        marketProjection,
        regionalStats,
        priceBand,
        sourceMeta: {
            provider: "HEPSIEMLAK_HTML",
            fetchedAt: new Date().toISOString(),
            scope: criteria.neighborhood ? "neighborhood" : criteria.district ? "district" : "city",
            recordCount: rawComparables.length,
            sampleCount: comparables.length,
            resolverMode: process.env.HEPSIEMLAK_URL_RESOLVER_MODE || "CANDIDATES_ONLY",
            searchUrls: {
                latest: latest.url,
                low: low.url,
                high: high.url,
            },
            serpUsed: Boolean(process.env.SERPAPI_KEY) &&
                (process.env.HEPSIEMLAK_URL_RESOLVER_MODE || "CANDIDATES_ONLY") === "CANDIDATES_THEN_SERP",
        },
    };
}

export {
    fetchHepsiemlakHtmlComparableBundle,
    fetchHtml,
    parseSearchPage,
    fetchFirstWorkingCandidate,
};
