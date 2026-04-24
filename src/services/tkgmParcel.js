const IL_LIST_URL = "https://parselsorgu.tkgm.gov.tr/app/modules/administrativeQuery/data/ilListe.json";
const ILCE_LIST_URL = "https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api/idariYapi/ilceListe";
const MAHALLE_LIST_URL = "https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api/idariYapi/mahalleListe";
const PARSEL_URL = "https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api/parsel";

const REQUEST_HEADERS = {
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

function normalizePlaceName(value, { stripMahalle = false } = {}) {
    let text = asciiTurkish(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[']/g, "")
        .replace(/\./g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (stripMahalle) {
        text = text
            .replace(/\bmahallesi\b/g, "")
            .replace(/\bmah\b/g, "")
            .replace(/\bmh\b/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    return text;
}

function compactText(value) {
    return normalizePlaceName(value, { stripMahalle: true }).replace(/\s+/g, "");
}

async function fetchJson(url) {
    const response = await fetch(url, {
        headers: REQUEST_HEADERS,
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(`TKGM servisi cevap vermedi (${response.status})`);
    }

    return await response.json();
}

function pickFeatureByName(features, target, options = {}) {
    const list = Array.isArray(features) ? features : [];
    const normalizedTarget = normalizePlaceName(target, { stripMahalle: !!options.stripMahalle });
    const compactTarget = compactText(target);

    if (!normalizedTarget) return null;

    let match =
        list.find((item) => normalizePlaceName(item?.properties?.text, { stripMahalle: !!options.stripMahalle }) === normalizedTarget) ||
        list.find((item) => compactText(item?.properties?.text) === compactTarget) ||
        list.find((item) => normalizePlaceName(item?.properties?.text, { stripMahalle: !!options.stripMahalle }).includes(normalizedTarget)) ||
        list.find((item) => normalizedTarget.includes(normalizePlaceName(item?.properties?.text, { stripMahalle: !!options.stripMahalle })));

    return match || null;
}

function normalizeCityName(value) {
    const text = normalizePlaceName(value);
    if (text.includes("istanbul")) return "istanbul";
    return text;
}

function extractRings(geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return [];

    if (geometry.type === "Polygon") return geometry.coordinates.filter(Array.isArray);
    if (geometry.type === "MultiPolygon") {
        return geometry.coordinates.flatMap((polygon) => (Array.isArray(polygon) ? polygon.filter(Array.isArray) : []));
    }

    return [];
}

function ringArea(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return 0;
    let total = 0;
    for (let i = 0; i < ring.length; i += 1) {
        const [x1, y1] = ring[i] || [];
        const [x2, y2] = ring[(i + 1) % ring.length] || [];
        total += (Number(x1) || 0) * (Number(y2) || 0) - (Number(x2) || 0) * (Number(y1) || 0);
    }
    return Math.abs(total / 2);
}

function pickPrimaryRing(geometry) {
    const rings = extractRings(geometry);
    if (!rings.length) return [];
    return rings.slice().sort((a, b) => ringArea(b) - ringArea(a))[0] || [];
}

function computeBounds(points) {
    const xs = points.map((point) => Number(point?.[0])).filter(Number.isFinite);
    const ys = points.map((point) => Number(point?.[1])).filter(Number.isFinite);

    if (!xs.length || !ys.length) return null;

    return {
        minLon: Math.min(...xs),
        maxLon: Math.max(...xs),
        minLat: Math.min(...ys),
        maxLat: Math.max(...ys),
    };
}

function computeCenter(points, fallbackBounds) {
    const coords = points
        .map((point) => [Number(point?.[0]), Number(point?.[1])])
        .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));

    if (coords.length) {
        const sum = coords.reduce(
            (acc, [lon, lat]) => {
                acc.lon += lon;
                acc.lat += lat;
                return acc;
            },
            { lon: 0, lat: 0 }
        );

        return {
            lon: sum.lon / coords.length,
            lat: sum.lat / coords.length,
        };
    }

    if (!fallbackBounds) return null;

    return {
        lon: (fallbackBounds.minLon + fallbackBounds.maxLon) / 2,
        lat: (fallbackBounds.minLat + fallbackBounds.maxLat) / 2,
    };
}

function toParcelLookup(feature, context) {
    const properties = feature?.properties || {};
    const ring = pickPrimaryRing(feature?.geometry);
    const bounds = computeBounds(ring);
    const center = computeCenter(ring, bounds);

    return {
        source: "TKGM",
        fetchedAt: new Date().toISOString(),
        cityId: context.cityId,
        districtId: context.districtId,
        neighborhoodId: context.neighborhoodId,
        geometryType: feature?.geometry?.type || null,
        polygon: ring
            .map((point) => ({
                lon: Number(point?.[0]),
                lat: Number(point?.[1]),
            }))
            .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat)),
        bounds,
        center,
        properties: {
            city: properties.ilAd || context.cityName || null,
            district: properties.ilceAd || context.districtName || null,
            neighborhood: properties.mahalleAd || context.neighborhoodName || null,
            blockNo: properties.adaNo || context.blockNo || null,
            parcelNo: properties.parselNo || context.parcelNo || null,
            area: properties.alan || null,
            quality: properties.nitelik || null,
            pafta: properties.pafta || null,
            summary: properties.ozet || null,
            zeminTipi: properties.zeminKmdurum || null,
        },
    };
}

async function fetchParcelLookup({ city, district, neighborhood, blockNo, parcelNo }) {
    if (!city || !district || !neighborhood || !blockNo || !parcelNo) {
        return null;
    }

    const ilData = await fetchJson(IL_LIST_URL);
    const cityFeature = pickFeatureByName(ilData?.features, normalizeCityName(city));

    if (!cityFeature) {
        throw new Error(`TKGM il eşleşmesi bulunamadı: ${city}`);
    }

    const districtData = await fetchJson(`${ILCE_LIST_URL}/${cityFeature.properties.id}`);
    const districtFeature = pickFeatureByName(districtData?.features, district);

    if (!districtFeature) {
        throw new Error(`TKGM ilçe eşleşmesi bulunamadı: ${district}`);
    }

    const neighborhoodData = await fetchJson(`${MAHALLE_LIST_URL}/${districtFeature.properties.id}`);
    const neighborhoodFeature = pickFeatureByName(neighborhoodData?.features, neighborhood, { stripMahalle: true });

    if (!neighborhoodFeature) {
        throw new Error(`TKGM mahalle eşleşmesi bulunamadı: ${neighborhood}`);
    }

    const parcelData = await fetchJson(`${PARSEL_URL}/${neighborhoodFeature.properties.id}/${encodeURIComponent(blockNo)}/${encodeURIComponent(parcelNo)}`);

    if (parcelData?.Message) {
        throw new Error(parcelData.Message);
    }

    if (!parcelData?.geometry) {
        throw new Error("TKGM parsel geometrisi alınamadı.");
    }

    return toParcelLookup(parcelData, {
        cityId: cityFeature.properties.id,
        districtId: districtFeature.properties.id,
        neighborhoodId: neighborhoodFeature.properties.id,
        cityName: cityFeature.properties.text,
        districtName: districtFeature.properties.text,
        neighborhoodName: neighborhoodFeature.properties.text,
        blockNo,
        parcelNo,
    });
}

export {
    fetchParcelLookup,
};
