import {
    fetchCities as fetchAddressCities,
    fetchDistricts as fetchAddressDistricts,
    fetchNeighborhoods as fetchAddressNeighborhoods,
} from "../services/addressDirectory.js";
import {
    fetchCities as fetchTkgmCities,
    fetchDistricts as fetchTkgmDistricts,
    fetchNeighborhoods as fetchTkgmNeighborhoods,
} from "../services/tkgmParcel.js";
import {
    FREE_LOCATION_DATA_SOURCES,
    getOpenLocationProfile,
} from "../services/openLocationData.js";

export async function listCities(_req, res) {
    res.json(await fetchAddressCities());
}

export async function listDistricts(req, res) {
    res.json(await fetchAddressDistricts(req.query.cityId, req.query.cityName));
}

export async function listNeighborhoods(req, res) {
    res.json(await fetchAddressNeighborhoods(req.query.districtId, req.query.districtName, req.query.cityName));
}

export async function listTkgmCities(_req, res) {
    res.json(await fetchTkgmCities());
}

export async function listTkgmDistricts(req, res) {
    res.json(await fetchTkgmDistricts(req.query.cityId));
}

export async function listTkgmNeighborhoods(req, res) {
    res.json(await fetchTkgmNeighborhoods(req.query.districtId));
}

export async function listOpenLocationSources(_req, res) {
    res.json(FREE_LOCATION_DATA_SOURCES);
}

export async function openLocationProfile(req, res) {
    res.json(await getOpenLocationProfile(req.query || {}));
}
