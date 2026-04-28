const PRICE_MIN = 10_000;
const PRICE_MAX = 1_000_000_000;
const AREA_MIN = 10;
const AREA_MAX = 5_000;

function cleanString(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeTurkishText(value) {
    return cleanString(value)
        .toLocaleLowerCase("tr-TR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ı/g, "i")
        .replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ+.\-\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function numberFromLocale(value) {
    if (value === undefined || value === null || value === "") return null;
    let text = String(value)
        .replace(/\s/g, "")
        .replace(/[^\d.,-]/g, "");

    if (!text || text === "-") return null;

    const commaCount = (text.match(/,/g) || []).length;
    const dotCount = (text.match(/\./g) || []).length;

    if (commaCount && dotCount) {
        if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
            text = text.replace(/\./g, "").replace(",", ".");
        } else {
            text = text.replace(/,/g, "");
        }
    } else if (commaCount > 1) {
        text = text.replace(/,/g, "");
    } else if (dotCount > 1) {
        text = text.replace(/\./g, "");
    } else if (commaCount === 1) {
        const [head, tail] = text.split(",");
        text = tail.length === 3 && head.length <= 3 ? `${head}${tail}` : `${head}.${tail}`;
    } else if (dotCount === 1) {
        const [head, tail] = text.split(".");
        text = tail.length === 3 && head.length <= 3 ? `${head}${tail}` : text;
    }

    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePrice(value) {
    const number = numberFromLocale(value);
    if (!Number.isFinite(number)) return null;
    if (number < PRICE_MIN || number > PRICE_MAX) return null;
    return Math.round(number);
}

export function normalizeArea(value) {
    const number = numberFromLocale(value);
    if (!Number.isFinite(number)) return null;
    if (number < AREA_MIN || number > AREA_MAX) return null;
    return Math.round(number * 100) / 100;
}

export function extractCurrencyFromText(text) {
    const source = cleanString(text);
    if (!source) return null;
    if (/(?:€|eur|euro)/i.test(source)) return "EUR";
    if (/(?:\$|usd|dolar)/i.test(source)) return "USD";
    if (/(?:₺|tl|try|türk lirası|turk lirasi)/i.test(source)) return "TRY";
    return null;
}

export function extractPriceFromText(text) {
    const source = cleanString(text);
    if (!source) return null;

    const millionMatch = source.match(/(\d+(?:[.,]\d+)?)\s*(?:milyon|mn|mio)\s*(?:tl|try|₺)?/i);
    if (millionMatch) {
        const value = numberFromLocale(millionMatch[1]);
        const price = Number.isFinite(value) ? Math.round(value * 1_000_000) : null;
        if (price && price >= PRICE_MIN && price <= PRICE_MAX) return price;
    }

    const patterns = [
        /₺\s*(\d[\d.,]{3,})/gi,
        /(\d[\d.,]{3,})\s*(?:tl|try|₺)/gi,
        /(?:fiyat|price)\s*:?\s*(\d[\d.,]{3,})/gi,
    ];

    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const price = normalizePrice(match[1]);
            if (price) return price;
        }
    }

    return null;
}

export function extractAreaM2FromText(text) {
    const source = cleanString(text);
    if (!source) return null;

    const patterns = [
        /(?:brüt|brut|gross)\s*:?\s*(\d{1,4}(?:[.,]\d+)?)\s*(?:m2|m²|metrekare)/i,
        /(?:net)\s*:?\s*(\d{1,4}(?:[.,]\d+)?)\s*(?:m2|m²|metrekare)/i,
        /(\d{1,4}(?:[.,]\d+)?)\s*(?:m2|m²|metrekare)\s*(?:brüt|brut|gross|net)?/i,
    ];

    for (const pattern of patterns) {
        const match = source.match(pattern);
        const area = match ? normalizeArea(match[1]) : null;
        if (area) return area;
    }

    return null;
}

export function extractRoomTextFromText(text) {
    const source = cleanString(text);
    const studio = source.match(/\b(?:stüdyo|studio|1\+0)\b/i);
    if (studio) return "Stüdyo";

    const match = source.match(/(^|[^\d])(\d{1,2})\s*\+\s*(\d{1,2})([^\d]|$)/);
    return match ? `${Number(match[2])}+${Number(match[3])}` : null;
}

export function roomTextToCounts(roomText) {
    const text = cleanString(roomText);
    if (!text) return { roomCount: null, salonCount: null };
    if (/stüdyo|studio|1\+0/i.test(text)) return { roomCount: 0, salonCount: 1 };
    const match = text.match(/(\d{1,2})\s*\+\s*(\d{1,2})/);
    return {
        roomCount: match ? Number(match[1]) : null,
        salonCount: match ? Number(match[2]) : null,
    };
}

export function extractPropertyTypeFromText(text) {
    const normalized = normalizeTurkishText(text);
    if (!normalized) return null;
    if (/\bvilla\b/.test(normalized)) return "villa";
    if (/\brezidans|residence\b/.test(normalized)) return "residence";
    if (/\barsa|tarla|zeytinlik\b/.test(normalized)) return "land";
    if (/\bdukkan|magaza|ofis|isyeri|is yeri\b/.test(normalized)) return "commercial";
    if (/\bmüstakil|mustakil\b/.test(normalized)) return "detached";
    if (/\bdaire|apartman\b/.test(normalized)) return "apartment";
    return null;
}

export function extractCompoundNameFromText(text) {
    const source = cleanString(text);
    if (!source) return null;

    const patterns = [
        /([\p{L}\d'’.\-\s]{2,60})\s+(?:sitesi|site|residence|rezidans|konakları|konaklari|evleri|apartmanı|apartmani)/iu,
        /(?:site|proje)\s*:?\s*([\p{L}\d'’.\-\s]{2,60})/iu,
    ];

    for (const pattern of patterns) {
        const match = source.match(pattern);
        const value = cleanString(match?.[0] || match?.[1]);
        if (value && value.length <= 80) return value;
    }

    return null;
}

export function extractNeighborhoodFromText(text) {
    const match = cleanString(text).match(/([\p{L}\d'’.\-\s]{2,45})\s+(?:mahallesi|mah\.|mah|mh\.|mh)/iu);
    return match ? cleanString(match[1]) : null;
}

export function extractSearchResultComparableData(result = {}, input = {}) {
    const title = cleanString(result.title);
    const snippet = cleanString(result.snippet);
    const combined = [title, snippet].filter(Boolean).join(" ");
    const titleArea = extractAreaM2FromText(title);
    const snippetArea = extractAreaM2FromText(snippet);
    const titleRoom = extractRoomTextFromText(title);
    const snippetRoom = extractRoomTextFromText(snippet);
    const price = extractPriceFromText(combined);
    const area = titleArea ?? snippetArea;
    const roomText = (titleRoom ?? snippetRoom ?? cleanString(input.roomText)) || null;
    const currency = extractCurrencyFromText(combined) || "TRY";
    const propertyType = extractPropertyTypeFromText(combined) || cleanString(input.propertyType) || null;
    const compoundName = cleanString(input.compoundName) || extractCompoundNameFromText(combined);
    const neighborhood = cleanString(input.neighborhood) || extractNeighborhoodFromText(combined);
    const imageUrl = cleanString(result.thumbnailUrl || result.imageUrl || result.thumbnail);

    return {
        price,
        currency,
        areaM2: area,
        roomText,
        propertyType,
        compoundName,
        city: cleanString(input.city) || null,
        district: cleanString(input.district) || null,
        neighborhood: neighborhood || null,
        imageUrl: imageUrl || null,
        sources: {
            price: price ? (extractPriceFromText(title) ? "SEARCH_TITLE" : "SEARCH_SNIPPET") : "UNKNOWN",
            area: area ? (titleArea ? "SEARCH_TITLE" : "SEARCH_SNIPPET") : "UNKNOWN",
            room: roomText ? (titleRoom ? "SEARCH_TITLE" : snippetRoom ? "SEARCH_SNIPPET" : "MANUAL") : "UNKNOWN",
            image: imageUrl ? "SEARCH_THUMBNAIL" : "UNKNOWN",
            title: title ? "SEARCH_TITLE" : "UNKNOWN",
        },
    };
}
