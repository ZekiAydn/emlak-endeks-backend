const DEFAULT_BASE_URL = "https://api.turkiyeapi.dev/v1";
const BASE_URL = (process.env.ADDRESS_DIRECTORY_API_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
const CACHE_TTL_MS = Number(process.env.ADDRESS_DIRECTORY_CACHE_TTL_MS || 1000 * 60 * 60 * 24);
const REQUEST_TIMEOUT_MS = Number(process.env.ADDRESS_DIRECTORY_TIMEOUT_MS || 8000);

const cache = new Map();

function cacheKey(path) {
    return `${BASE_URL}${path}`;
}

function sortByName(items) {
    return items.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "tr"));
}

function normalizeName(value) {
    return String(value || "")
        .trim()
        .toLocaleLowerCase("tr-TR")
        .replace(/\s+/g, " ");
}

function publicId(rawId) {
    return rawId === null || rawId === undefined ? null : `trapi:${rawId}`;
}

function rawId(value) {
    const text = String(value || "");
    return text.startsWith("trapi:") ? text.slice("trapi:".length) : text;
}

function mapLocation(item) {
    return {
        id: publicId(item?.id),
        name: item?.name || null,
        source: "TURKIYE_API",
    };
}

async function fetchDirectory(path) {
    const key = cacheKey(path);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(key, {
            headers: {
                accept: "application/json",
                "user-agent": "EmlakEndeks/1.0",
            },
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Adres dizini cevap vermedi (${response.status})`);
        }

        const body = await response.json();
        if (body?.status && body.status !== "OK") {
            throw new Error(body.error || "Adres dizini veri döndüremedi.");
        }

        const value = Array.isArray(body?.data) ? body.data : [];
        cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        return value;
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchCities() {
    const rows = await fetchDirectory("/provinces?limit=100");
    return sortByName(rows.map(mapLocation).filter((item) => item.id !== null && item.name));
}

async function resolveProvinceId(cityId, cityName) {
    if (cityName) {
        const rows = await fetchDirectory("/provinces?limit=100");
        const match = rows.find((item) => normalizeName(item.name) === normalizeName(cityName));
        if (match?.id) return match.id;
    }
    return rawId(cityId);
}

async function resolveDistrictId(districtId, districtName, cityName) {
    if (districtName && cityName) {
        const provinceId = await resolveProvinceId(null, cityName);
        if (provinceId) {
            const rows = await fetchDirectory(`/districts?provinceId=${encodeURIComponent(provinceId)}&limit=1000`);
            const match = rows.find((item) => normalizeName(item.name) === normalizeName(districtName));
            if (match?.id) return match.id;
        }
    }
    return rawId(districtId);
}

async function fetchDistricts(cityId, cityName) {
    const provinceId = await resolveProvinceId(cityId, cityName);
    if (!provinceId) return [];
    const rows = await fetchDirectory(`/districts?provinceId=${encodeURIComponent(provinceId)}&limit=1000`);
    return sortByName(rows.map(mapLocation).filter((item) => item.id !== null && item.name));
}

async function fetchNeighborhoods(districtId, districtName, cityName) {
    const resolvedDistrictId = await resolveDistrictId(districtId, districtName, cityName);
    if (!resolvedDistrictId) return [];
    const rows = await fetchDirectory(`/neighborhoods?districtId=${encodeURIComponent(resolvedDistrictId)}&limit=1000`);
    return sortByName(rows.map(mapLocation).filter((item) => item.id !== null && item.name));
}

export {
    fetchCities,
    fetchDistricts,
    fetchNeighborhoods,
};
