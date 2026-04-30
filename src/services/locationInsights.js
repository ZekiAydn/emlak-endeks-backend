import prisma from "../prisma.js";
import { normalizePropertyText } from "./propertyCategory.js";

const OVERPASS_URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const IETT_SOAP_URL = "https://api.ibb.gov.tr/iett/UlasimAnaVeri/HatDurakGuzergah.asmx";
const IETT_WSDL_URL = `${IETT_SOAP_URL}?wsdl`;
const USER_AGENT = "emlak-endeks-location-insights/1.0";

const POI_RADIUS_METERS = 500;
const DAILY_ACCESS_RADIUS_METERS = 700;
const POI_SEARCH_RADIUS_METERS = 1500;
const TRANSPORT_SEARCH_RADIUS_METERS = 3000;

const POI_CATEGORY_ORDER = [
    "school",
    "hospital",
    "familyHealth",
    "pharmacy",
    "market",
    "park",
    "mosque",
    "bank",
    "mall",
    "parking",
];

const POI_LABELS = {
    school: "okul",
    hospital: "hastane",
    familyHealth: "aile sağlığı/klinik",
    pharmacy: "eczane",
    market: "market",
    park: "park",
    mosque: "cami",
    bank: "banka",
    mall: "AVM",
    parking: "otopark",
};

const TRANSPORT_LABELS = {
    busStop: "otobüs durağı",
    metro: "metro",
    marmaray: "Marmaray",
    tram: "tramvay",
    metrobus: "metrobüs",
    rail: "raylı sistem",
};

let iettStopsCache = {
    fetchedAt: 0,
    stops: null,
};

function toFiniteNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLocationKey(value) {
    return normalizePropertyText(value)
        .replace(/\b(mahalle|mahallesi|mah|mh|koyu|koy|ilce|ilcesi|nufusu)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function compactLocationKey(value) {
    return normalizeLocationKey(value).replace(/\s+/g, "");
}

function firstText(...values) {
    return values.map((value) => String(value || "").trim()).find(Boolean) || null;
}

function numberText(value) {
    const n = toFiniteNumber(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n).toLocaleString("tr-TR");
}

function percentText(value) {
    const n = toFiniteNumber(value);
    if (!Number.isFinite(n)) return null;
    return `${n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function distanceText(value) {
    const n = toFiniteNumber(value);
    if (!Number.isFinite(n)) return null;
    if (n < 1000) return `${Math.round(n)} m`;
    return `${(n / 1000).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

function haversineMeters(a, b) {
    const lat1 = toFiniteNumber(a?.lat);
    const lon1 = toFiniteNumber(a?.lon);
    const lat2 = toFiniteNumber(b?.lat);
    const lon2 = toFiniteNumber(b?.lon);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;

    const toRad = (value) => (value * Math.PI) / 180;
    const earthMeters = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const p1 = toRad(lat1);
    const p2 = toRad(lat2);
    const h =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    return 2 * earthMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function parcelCenter(parcelLookup) {
    const centerLat = toFiniteNumber(parcelLookup?.center?.lat ?? parcelLookup?.center?.latitude);
    const centerLon = toFiniteNumber(parcelLookup?.center?.lon ?? parcelLookup?.center?.lng ?? parcelLookup?.center?.longitude);
    if (Number.isFinite(centerLat) && Number.isFinite(centerLon)) return { lat: centerLat, lon: centerLon };

    const polygon = Array.isArray(parcelLookup?.polygon) ? parcelLookup.polygon : [];
    const points = polygon
        .map((point) => ({
            lat: toFiniteNumber(point?.lat ?? point?.latitude),
            lon: toFiniteNumber(point?.lon ?? point?.lng ?? point?.longitude),
        }))
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));

    if (points.length) {
        return {
            lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
            lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
        };
    }

    const minLat = toFiniteNumber(parcelLookup?.bounds?.minLat);
    const maxLat = toFiniteNumber(parcelLookup?.bounds?.maxLat);
    const minLon = toFiniteNumber(parcelLookup?.bounds?.minLon);
    const maxLon = toFiniteNumber(parcelLookup?.bounds?.maxLon);
    if ([minLat, maxLat, minLon, maxLon].every(Number.isFinite)) {
        return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
    }

    return null;
}

function locationFromInputs({ location = {}, parcelLookup = {}, criteria = {} } = {}) {
    const properties = parcelLookup?.properties || {};
    return {
        city: firstText(properties.city, location.city, criteria.city),
        district: firstText(properties.district, location.district, criteria.district),
        neighborhood: firstText(properties.neighborhood, location.neighborhood, criteria.neighborhood),
    };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                "user-agent": USER_AGENT,
                ...(options.headers || {}),
            },
        });
    } finally {
        clearTimeout(timer);
    }
}

function buildOverpassQuery(point) {
    const lat = Number(point.lat).toFixed(7);
    const lon = Number(point.lon).toFixed(7);

    return `
[out:json][timeout:25];
(
  nwr["amenity"~"^(school|kindergarten|college|university|hospital|clinic|doctors|pharmacy|place_of_worship|bank|parking|parking_entrance)$"](around:${POI_SEARCH_RADIUS_METERS},${lat},${lon});
  nwr["healthcare"~"^(hospital|clinic|doctor|centre)$"](around:${POI_SEARCH_RADIUS_METERS},${lat},${lon});
  nwr["shop"~"^(supermarket|convenience|greengrocer|mall)$"](around:${POI_SEARCH_RADIUS_METERS},${lat},${lon});
  nwr["leisure"="park"](around:${POI_SEARCH_RADIUS_METERS},${lat},${lon});
  nwr["highway"="bus_stop"](around:${TRANSPORT_SEARCH_RADIUS_METERS},${lat},${lon});
  nwr["public_transport"~"^(platform|stop_position|station)$"](around:${TRANSPORT_SEARCH_RADIUS_METERS},${lat},${lon});
  nwr["railway"~"^(station|halt|tram_stop|subway_entrance)$"](around:${TRANSPORT_SEARCH_RADIUS_METERS},${lat},${lon});
);
out tags center;
`.trim();
}

async function fetchOverpassElements(point) {
    const response = await fetchWithTimeout(
        OVERPASS_URL,
        {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                accept: "application/json",
            },
            body: new URLSearchParams({ data: buildOverpassQuery(point) }),
        },
        18000
    );

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Overpass API ${response.status}: ${text.slice(0, 180)}`);
    }

    const json = await response.json();
    return Array.isArray(json?.elements) ? json.elements : [];
}

function elementPoint(element) {
    const lat = toFiniteNumber(element?.lat ?? element?.center?.lat);
    const lon = toFiniteNumber(element?.lon ?? element?.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
}

function elementName(tags = {}) {
    return firstText(tags.name, tags["name:tr"], tags["official_name"], tags.operator, "İsimsiz nokta");
}

function textHasAny(text, values) {
    const normalized = normalizePropertyText(text);
    return values.some((value) => normalized.includes(value));
}

function poiCategory(tags = {}) {
    const amenity = normalizePropertyText(tags.amenity);
    const healthcare = normalizePropertyText(tags.healthcare);
    const shop = normalizePropertyText(tags.shop);
    const leisure = normalizePropertyText(tags.leisure);
    const religion = normalizePropertyText(tags.religion);
    const name = `${tags.name || ""} ${tags.operator || ""}`;

    if (["school", "kindergarten", "college", "university"].includes(amenity)) return "school";
    if (amenity === "hospital" || healthcare === "hospital") return "hospital";
    if (["clinic", "doctors"].includes(amenity) || ["clinic", "doctor", "centre"].includes(healthcare)) return "familyHealth";
    if (amenity === "pharmacy") return "pharmacy";
    if (["supermarket", "convenience", "greengrocer"].includes(shop)) return "market";
    if (leisure === "park") return "park";
    if (amenity === "place_of_worship" && (religion === "muslim" || textHasAny(name, ["cami", "mosque"]))) return "mosque";
    if (amenity === "bank") return "bank";
    if (shop === "mall") return "mall";
    if (["parking", "parking_entrance"].includes(amenity)) return "parking";
    return null;
}

function transportCategories(tags = {}) {
    const categories = new Set();
    const amenity = normalizePropertyText(tags.amenity);
    const highway = normalizePropertyText(tags.highway);
    const publicTransport = normalizePropertyText(tags.public_transport);
    const railway = normalizePropertyText(tags.railway);
    const station = normalizePropertyText(tags.station);
    const bus = normalizePropertyText(tags.bus);
    const text = `${tags.name || ""} ${tags.network || ""} ${tags.operator || ""} ${tags.route || ""}`;
    const normalizedText = normalizePropertyText(text);
    const hasTransitTag = Boolean(
        railway ||
        station ||
        normalizePropertyText(tags.subway) === "yes" ||
        ["platform", "stop_position", "station"].includes(publicTransport) ||
        highway === "bus_stop"
    );

    if (
        highway === "bus_stop" ||
        bus === "yes" ||
        (["platform", "stop_position", "station"].includes(publicTransport) && normalizedText.includes("otobus"))
    ) {
        categories.add("busStop");
    }

    if (normalizedText.includes("metrobus") && hasTransitTag) {
        categories.add("metrobus");
    }

    if (normalizedText.includes("marmaray") && hasTransitTag) {
        categories.add("marmaray");
    }

    if (railway === "tram_stop" || ((normalizedText.includes("tramvay") || normalizedText.includes("tram")) && hasTransitTag)) {
        categories.add("tram");
    }

    if (
        railway === "subway_entrance" ||
        station === "subway" ||
        normalizePropertyText(tags.subway) === "yes" ||
        (normalizedText.includes("metro") && !normalizedText.includes("metrobus") && hasTransitTag)
    ) {
        categories.add("metro");
    }

    if (
        ["station", "halt"].includes(railway) ||
        station === "rail" ||
        ["train_station", "ferry_terminal"].includes(amenity)
    ) {
        if (!categories.has("metro") && !categories.has("marmaray") && !categories.has("tram")) categories.add("rail");
    }

    return [...categories];
}

function comparablePlace(element, point, source = "OSM") {
    const placePoint = elementPoint(element);
    const distanceMeters = placePoint ? haversineMeters(point, placePoint) : null;
    if (!Number.isFinite(distanceMeters)) return null;
    return {
        id: `${source}:${element.type || "node"}:${element.id}`,
        name: elementName(element.tags || {}),
        distanceMeters: Math.round(distanceMeters),
        lat: placePoint.lat,
        lon: placePoint.lon,
        source,
        osmType: element.type || null,
        osmId: element.id || null,
    };
}

function buildPoiAnalysis(elements, point) {
    const bucket = Object.fromEntries(POI_CATEGORY_ORDER.map((key) => [key, []]));

    elements.forEach((element) => {
        const category = poiCategory(element.tags || {});
        if (!category) return;
        const place = comparablePlace(element, point);
        if (!place || place.distanceMeters > POI_SEARCH_RADIUS_METERS) return;
        bucket[category].push(place);
    });

    const categories = {};
    POI_CATEGORY_ORDER.forEach((key) => {
        const sorted = bucket[key].sort((a, b) => a.distanceMeters - b.distanceMeters);
        categories[key] = {
            key,
            label: POI_LABELS[key],
            radiusMeters: POI_RADIUS_METERS,
            dailyAccessRadiusMeters: DAILY_ACCESS_RADIUS_METERS,
            countWithin500m: sorted.filter((item) => item.distanceMeters <= POI_RADIUS_METERS).length,
            countWithin700m: sorted.filter((item) => item.distanceMeters <= DAILY_ACCESS_RADIUS_METERS).length,
            nearest: sorted[0] || null,
            nearestItems: sorted.slice(0, 5),
        };
    });

    return {
        radiusMeters: POI_RADIUS_METERS,
        searchRadiusMeters: POI_SEARCH_RADIUS_METERS,
        categories,
    };
}

function parsePointWkt(value) {
    const match = String(value || "").match(/POINT\s*\(\s*([0-9.,-]+)\s+([0-9.,-]+)\s*\)/i);
    if (!match) return null;
    const lon = toFiniteNumber(match[1]);
    const lat = toFiniteNumber(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
}

function decodeXmlEntities(value) {
    return String(value || "")
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

async function fetchIettStops() {
    const ttlMs = 12 * 60 * 60 * 1000;
    if (Array.isArray(iettStopsCache.stops) && Date.now() - iettStopsCache.fetchedAt < ttlMs) {
        return iettStopsCache.stops;
    }

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetDurak_json xmlns="http://tempuri.org/">
      <DurakKodu></DurakKodu>
    </GetDurak_json>
  </soap:Body>
</soap:Envelope>`;

    const response = await fetchWithTimeout(
        IETT_SOAP_URL,
        {
            method: "POST",
            headers: {
                "content-type": "text/xml; charset=utf-8",
                SOAPAction: "\"http://tempuri.org/GetDurak_json\"",
            },
            body: xml,
        },
        12000
    );

    if (!response.ok) {
        throw new Error(`IETT durak servisi ${response.status}`);
    }

    const text = await response.text();
    const result = text.match(/<GetDurak_jsonResult>([\s\S]*?)<\/GetDurak_jsonResult>/)?.[1];
    if (!result) throw new Error("IETT durak servisi beklenen JSON alanını döndürmedi.");

    const rows = JSON.parse(decodeXmlEntities(result));
    const stops = rows
        .map((row) => {
            const point = parsePointWkt(row.KOORDINAT);
            if (!point) return null;
            return {
                id: `IETT:${row.SDURAKKODU}`,
                name: firstText(row.SDURAKADI, row.SDURAKKODU),
                code: row.SDURAKKODU ? String(row.SDURAKKODU) : null,
                lat: point.lat,
                lon: point.lon,
                source: "IETT",
            };
        })
        .filter(Boolean);

    iettStopsCache = { fetchedAt: Date.now(), stops };
    return stops;
}

async function nearbyIettStops(point, city) {
    if (process.env.IETT_STOPS_DISABLED === "1") return [];
    if (compactLocationKey(city) !== "istanbul") return [];

    const stops = await fetchIettStops();
    return stops
        .map((stop) => ({
            ...stop,
            distanceMeters: Math.round(haversineMeters(point, stop)),
        }))
        .filter((stop) => Number.isFinite(stop.distanceMeters) && stop.distanceMeters <= TRANSPORT_SEARCH_RADIUS_METERS)
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, 30);
}

function buildTransportAccess(elements, point, iettStops = []) {
    const bucket = {
        busStop: [],
        metro: [],
        marmaray: [],
        tram: [],
        metrobus: [],
        rail: [],
    };

    elements.forEach((element) => {
        const categories = transportCategories(element.tags || {});
        if (!categories.length) return;
        const place = comparablePlace(element, point);
        if (!place || place.distanceMeters > TRANSPORT_SEARCH_RADIUS_METERS) return;
        categories.forEach((category) => bucket[category].push(place));
    });

    iettStops.forEach((stop) => {
        bucket.busStop.push({
            id: stop.id,
            name: stop.name,
            code: stop.code,
            distanceMeters: stop.distanceMeters,
            lat: stop.lat,
            lon: stop.lon,
            source: "IETT",
        });
    });

    const categories = {};
    Object.keys(bucket).forEach((key) => {
        const seen = new Set();
        const sorted = bucket[key]
            .filter((item) => {
                const id = item.id || `${item.name}:${item.distanceMeters}`;
                if (seen.has(id)) return false;
                seen.add(id);
                return true;
            })
            .sort((a, b) => a.distanceMeters - b.distanceMeters);
        categories[key] = {
            key,
            label: TRANSPORT_LABELS[key],
            searchRadiusMeters: TRANSPORT_SEARCH_RADIUS_METERS,
            countWithin300m: sorted.filter((item) => item.distanceMeters <= 300).length,
            countWithin800m: sorted.filter((item) => item.distanceMeters <= 800).length,
            nearest: sorted[0] || null,
            nearestItems: sorted.slice(0, 5),
        };
    });

    const railCandidates = ["metro", "marmaray", "tram", "rail"]
        .map((key) => categories[key]?.nearest ? { ...categories[key].nearest, category: key, label: categories[key].label } : null)
        .filter(Boolean)
        .sort((a, b) => a.distanceMeters - b.distanceMeters);

    return {
        searchRadiusMeters: TRANSPORT_SEARCH_RADIUS_METERS,
        categories,
        nearestBusStop: categories.busStop.nearest || null,
        nearestRailSystem: railCandidates[0] || null,
        nearestMetrobus: categories.metrobus.nearest || null,
    };
}

function rowsToMetricMap(rows = []) {
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
    return metrics;
}

async function findLocationRows({ city, district, neighborhood, level }) {
    const normalizedCity = normalizeLocationKey(city);
    const normalizedDistrict = normalizeLocationKey(district);
    const normalizedNeighborhood = normalizeLocationKey(neighborhood);

    const baseWhere = {
        locationLevel: level,
        metricKey: { in: ["population_total", "population_male", "population_female", "neighborhood_count", "village_count"] },
    };
    if (normalizedCity) baseWhere.normalizedCity = normalizedCity;
    if (normalizedDistrict) baseWhere.normalizedDistrict = normalizedDistrict;
    if (level === "NEIGHBORHOOD" && normalizedNeighborhood) baseWhere.normalizedNeighborhood = normalizedNeighborhood;

    let rows = await prisma.openLocationStat.findMany({
        where: baseWhere,
        orderBy: [{ year: "desc" }, { source: "asc" }, { metricKey: "asc" }],
        take: 50,
    });

    if (rows.length || level !== "NEIGHBORHOOD" || !normalizedNeighborhood) return rows;

    const districtRows = await prisma.openLocationStat.findMany({
        where: {
            locationLevel: "NEIGHBORHOOD",
            metricKey: { in: ["population_total", "population_male", "population_female"] },
            ...(normalizedCity ? { normalizedCity } : {}),
            ...(normalizedDistrict ? { normalizedDistrict } : {}),
        },
        orderBy: [{ year: "desc" }, { source: "asc" }, { metricKey: "asc" }],
        take: 500,
    });

    const target = compactLocationKey(neighborhood);
    const matchingSourceKeys = new Set(
        districtRows
            .filter((row) => compactLocationKey(row.normalizedNeighborhood) === target)
            .map((row) => row.sourceKey)
    );

    return districtRows.filter((row) => matchingSourceKeys.has(row.sourceKey));
}

async function buildNeighborhoodProfile(location = {}) {
    if (!location.city || !location.district) return null;

    const [neighborhoodRows, districtRows] = await Promise.all([
        location.neighborhood ? findLocationRows({ ...location, level: "NEIGHBORHOOD" }) : Promise.resolve([]),
        findLocationRows({ ...location, neighborhood: null, level: "DISTRICT" }),
    ]);

    const neighborhoodMetrics = rowsToMetricMap(neighborhoodRows);
    const districtMetrics = rowsToMetricMap(districtRows);
    const neighborhoodPopulation = toFiniteNumber(neighborhoodMetrics.population_total?.value);
    const districtPopulation = toFiniteNumber(districtMetrics.population_total?.value);
    const districtSharePct =
        Number.isFinite(neighborhoodPopulation) && Number.isFinite(districtPopulation) && districtPopulation > 0
            ? (neighborhoodPopulation / districtPopulation) * 100
            : null;

    return {
        city: location.city || null,
        district: location.district || null,
        neighborhood: location.neighborhood || null,
        year: neighborhoodMetrics.population_total?.year || districtMetrics.population_total?.year || null,
        populationTotal: neighborhoodPopulation,
        populationMale: toFiniteNumber(neighborhoodMetrics.population_male?.value),
        populationFemale: toFiniteNumber(neighborhoodMetrics.population_female?.value),
        districtPopulationTotal: districtPopulation,
        districtNeighborhoodCount: toFiniteNumber(districtMetrics.neighborhood_count?.value),
        districtVillageCount: toFiniteNumber(districtMetrics.village_count?.value),
        districtSharePct,
        metrics: {
            neighborhood: neighborhoodMetrics,
            district: districtMetrics,
        },
        source: neighborhoodMetrics.population_total?.source || districtMetrics.population_total?.source || null,
        sourceReliability:
            neighborhoodMetrics.population_total?.sourceReliability ||
            districtMetrics.population_total?.sourceReliability ||
            null,
        sourceUrl: neighborhoodMetrics.population_total?.sourceUrl || districtMetrics.population_total?.sourceUrl || null,
    };
}

function proximityPoints(distance, bands) {
    const n = toFiniteNumber(distance);
    if (!Number.isFinite(n)) return { points: 0, status: "Veri yok" };
    if (n <= bands.strongMeters) return { points: bands.strongPoints, status: "güçlü" };
    if (n <= bands.goodMeters) return { points: bands.goodPoints, status: "iyi" };
    if (n <= bands.mediumMeters) return { points: bands.mediumPoints, status: "orta" };
    return { points: 0, status: "uzak" };
}

function buildLocationScore(poiAnalysis, transportAccess) {
    const factors = [];
    let score = 0;

    const addDistanceFactor = (key, label, distance, bands) => {
        const result = proximityPoints(distance, bands);
        score += result.points;
        factors.push({
            key,
            label,
            distanceMeters: Number.isFinite(toFiniteNumber(distance)) ? Math.round(toFiniteNumber(distance)) : null,
            status: result.status,
            points: result.points,
            maxPoints: bands.strongPoints,
        });
    };

    addDistanceFactor("railSystem", "Raylı sistem", transportAccess?.nearestRailSystem?.distanceMeters, {
        strongMeters: 800,
        goodMeters: 1200,
        mediumMeters: 2000,
        strongPoints: 25,
        goodPoints: 18,
        mediumPoints: 10,
    });
    addDistanceFactor("busStop", "Otobüs durağı", transportAccess?.nearestBusStop?.distanceMeters, {
        strongMeters: 300,
        goodMeters: 500,
        mediumMeters: 800,
        strongPoints: 20,
        goodPoints: 14,
        mediumPoints: 8,
    });
    addDistanceFactor("market", "Market", poiAnalysis?.categories?.market?.nearest?.distanceMeters, {
        strongMeters: 500,
        goodMeters: 700,
        mediumMeters: 1000,
        strongPoints: 12,
        goodPoints: 8,
        mediumPoints: 4,
    });
    addDistanceFactor("pharmacy", "Eczane", poiAnalysis?.categories?.pharmacy?.nearest?.distanceMeters, {
        strongMeters: 500,
        goodMeters: 700,
        mediumMeters: 1000,
        strongPoints: 10,
        goodPoints: 7,
        mediumPoints: 4,
    });
    addDistanceFactor("school", "Okul", poiAnalysis?.categories?.school?.nearest?.distanceMeters, {
        strongMeters: 500,
        goodMeters: 700,
        mediumMeters: 1000,
        strongPoints: 10,
        goodPoints: 7,
        mediumPoints: 4,
    });
    addDistanceFactor("park", "Park", poiAnalysis?.categories?.park?.nearest?.distanceMeters, {
        strongMeters: 500,
        goodMeters: 700,
        mediumMeters: 1000,
        strongPoints: 5,
        goodPoints: 3,
        mediumPoints: 1,
    });

    const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
    let label = "Sınırlı";
    if (normalizedScore >= 80) label = "Çok güçlü";
    else if (normalizedScore >= 65) label = "Güçlü";
    else if (normalizedScore >= 50) label = "Orta";

    return {
        score: normalizedScore,
        label,
        maxScore: 100,
        factors,
        valuationHint:
            "Konum skoru fiyatlamaya agresif prim olarak basılmaz; emsal fiyat bandı yanında likidite ve küçük düzeltme notu olarak kullanılır.",
        suggestedAdjustmentPct:
            normalizedScore >= 80 ? { min: 1, max: 3 } :
            normalizedScore >= 65 ? { min: 0, max: 2 } :
            normalizedScore >= 50 ? { min: -1, max: 1 } :
            { min: -3, max: 0 },
    };
}

function summarizePoi(poiAnalysis) {
    const parts = POI_CATEGORY_ORDER
        .map((key) => {
            const category = poiAnalysis?.categories?.[key];
            if (!category?.countWithin500m) return null;
            return `${category.countWithin500m} ${POI_LABELS[key]}`;
        })
        .filter(Boolean);

    const nearestParts = ["school", "pharmacy", "market", "park"]
        .map((key) => {
            const nearest = poiAnalysis?.categories?.[key]?.nearest;
            if (!nearest) return null;
            return `En yakın ${POI_LABELS[key]} ${distanceText(nearest.distanceMeters)}`;
        })
        .filter(Boolean);

    if (!parts.length && !nearestParts.length) {
        return `${POI_RADIUS_METERS} m içinde OSM üzerinde belirgin POI kaydı bulunamadı.`;
    }

    return [
        parts.length ? `${POI_RADIUS_METERS} m içinde ${parts.join(", ")} bulundu.` : null,
        nearestParts.length ? nearestParts.join("; ") + "." : null,
    ].filter(Boolean).join(" ");
}

function summarizeTransport(transportAccess) {
    const bus = transportAccess?.nearestBusStop;
    const rail = transportAccess?.nearestRailSystem;
    const metrobus = transportAccess?.nearestMetrobus;
    const parts = [];

    if (bus) parts.push(`En yakın otobüs durağı ${distanceText(bus.distanceMeters)} (${bus.name}).`);
    if (rail) parts.push(`En yakın raylı sistem ${distanceText(rail.distanceMeters)} (${rail.name}).`);
    if (metrobus) parts.push(`En yakın metrobüs durağı ${distanceText(metrobus.distanceMeters)} (${metrobus.name}).`);

    return parts.length ? parts.join(" ") : "Yakın çevrede OSM/IETT üzerinde ulaşım durağı tespit edilemedi.";
}

function summarizeProfile(profile, location) {
    if (!profile?.populationTotal && !profile?.districtPopulationTotal) {
        return `${firstText(location.neighborhood, "Mahalle")} için kayıtlı nüfus profili bulunamadı.`;
    }

    const locationName = firstText(profile.neighborhood, location.neighborhood, profile.district, location.district, "Bölge");
    const parts = [];
    if (profile.populationTotal) {
        parts.push(
            `${locationName} ${profile.year || ""} nüfusu ${numberText(profile.populationTotal)} kişi` +
                `${profile.populationMale || profile.populationFemale ? `; erkek ${numberText(profile.populationMale)}, kadın ${numberText(profile.populationFemale)}` : ""}.`
        );
    }
    if (profile.districtPopulationTotal) {
        parts.push(
            `${firstText(profile.district, location.district, "İlçe")} ilçe nüfusu ${numberText(profile.districtPopulationTotal)} kişi` +
                `${profile.districtSharePct ? `; mahalle ilçe nüfusunun yaklaşık ${percentText(profile.districtSharePct)}'ini oluşturuyor` : ""}.`
        );
    }

    return parts.join(" ");
}

function summarizeScore(locationScore) {
    const strongFactors = (locationScore?.factors || [])
        .filter((factor) => factor.points > 0 && factor.distanceMeters !== null)
        .slice(0, 4)
        .map((factor) => `${factor.label.toLowerCase()} ${distanceText(factor.distanceMeters)} (${factor.status})`);

    return [
        `Konum skoru ${locationScore.score}/100 (${locationScore.label}).`,
        strongFactors.length ? `Öne çıkan erişimler: ${strongFactors.join(", ")}.` : null,
        locationScore.valuationHint,
    ].filter(Boolean).join(" ");
}

function buildSourceSummary({ overpassOk, iettOk, profile }) {
    const sources = ["OSM/Overpass"];
    if (iettOk) sources.push("İETT Hat-Durak-Güzergah");
    if (profile?.source) sources.push(`${profile.source} nüfus verisi`);
    return `Kaynaklar: ${sources.join(", ")}. Mesafeler parsel merkezinden kuş uçuşudur; saha kontrolü, güncel imar ve resmi kurum doğrulaması yerine geçmez.${!overpassOk ? " Overpass erişimi sınırlı olduğu için POI/ulaşım kapsamı eksik olabilir." : ""}`;
}

export async function buildLocationInsights(options = {}) {
    const warnings = [];
    const point = parcelCenter(options.parcelLookup);
    const location = locationFromInputs(options);

    const [profileResult, overpassResult, iettResult] = await Promise.allSettled([
        buildNeighborhoodProfile(location),
        point ? fetchOverpassElements(point) : Promise.resolve([]),
        point ? nearbyIettStops(point, location.city) : Promise.resolve([]),
    ]);

    const profile = profileResult.status === "fulfilled" ? profileResult.value : null;
    if (profileResult.status === "rejected") warnings.push(`Mahalle nüfus profili okunamadı: ${String(profileResult.reason?.message || profileResult.reason)}`);

    const overpassElements = overpassResult.status === "fulfilled" ? overpassResult.value : [];
    if (!point) warnings.push("Konum analizi için parsel merkez koordinatı bulunamadı.");
    if (overpassResult.status === "rejected") warnings.push(`OSM/Overpass sorgusu başarısız: ${String(overpassResult.reason?.message || overpassResult.reason)}`);

    const iettStops = iettResult.status === "fulfilled" ? iettResult.value : [];
    const iettOk = iettResult.status === "fulfilled" && (iettStops.length > 0 || compactLocationKey(location.city) === "istanbul");
    if (iettResult.status === "rejected") warnings.push(`İETT durak servisi okunamadı: ${String(iettResult.reason?.message || iettResult.reason)}`);

    const poiAnalysis = point ? buildPoiAnalysis(overpassElements, point) : null;
    const transportAccess = point ? buildTransportAccess(overpassElements, point, iettStops) : null;
    const locationScore = point ? buildLocationScore(poiAnalysis, transportAccess) : null;

    const neighborhoodProfileSummary = summarizeProfile(profile, location);
    const poiSummary = poiAnalysis ? summarizePoi(poiAnalysis) : "POI analizi için parsel merkez koordinatı bulunamadı.";
    const transitSummary = transportAccess ? summarizeTransport(transportAccess) : "Ulaşım erişimi için parsel merkez koordinatı bulunamadı.";
    const scoreSummary = locationScore ? summarizeScore(locationScore) : "Konum skoru için parsel merkez koordinatı bulunamadı.";
    const sourceSummary = buildSourceSummary({
        overpassOk: overpassResult.status === "fulfilled",
        iettOk,
        profile,
    });

    return {
        type: "LOCATION_INSIGHTS",
        version: 1,
        generatedAt: new Date().toISOString(),
        location,
        subjectPoint: point,
        neighborhoodProfile: profile,
        poiAnalysis,
        transportAccess,
        locationScore,
        summarySections: [
            { key: "nearbyPoi", title: "Yakın çevre POI analizi", text: poiSummary },
            { key: "transportAccess", title: "Ulaşım erişilebilirliği", text: transitSummary },
            { key: "locationScore", title: "Konum skoru", text: scoreSummary },
            { key: "neighborhoodProfile", title: "Mahalle profili", text: neighborhoodProfileSummary },
        ],
        poiSummary,
        transitSummary,
        locationScoreSummary: scoreSummary,
        neighborhoodProfileSummary,
        demographicsSummary: neighborhoodProfileSummary,
        nearbyPlacesSummary: poiSummary,
        saleMarketSummary: transitSummary,
        rentalMarketSummary: scoreSummary,
        riskSummary: sourceSummary,
        sourceMeta: {
            providers: [
                "OpenStreetMap Overpass API",
                ...(iettOk ? ["IETT Hat-Durak-Guzergah Web Servisi"] : []),
                ...(profile?.source ? [profile.source] : []),
            ],
            overpassUrl: OVERPASS_URL,
            iettWsdlUrl: compactLocationKey(location.city) === "istanbul" ? IETT_WSDL_URL : null,
            poiRadiusMeters: POI_RADIUS_METERS,
            poiSearchRadiusMeters: POI_SEARCH_RADIUS_METERS,
            dailyAccessRadiusMeters: DAILY_ACCESS_RADIUS_METERS,
            transportSearchRadiusMeters: TRANSPORT_SEARCH_RADIUS_METERS,
            populationSourceReliability: profile?.sourceReliability || null,
        },
        warnings,
    };
}
