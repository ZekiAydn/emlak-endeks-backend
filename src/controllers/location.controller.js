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
