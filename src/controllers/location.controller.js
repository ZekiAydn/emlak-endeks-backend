import { fetchCities, fetchDistricts, fetchNeighborhoods } from "../services/addressDirectory.js";

export async function listCities(_req, res) {
    res.json(await fetchCities());
}

export async function listDistricts(req, res) {
    res.json(await fetchDistricts(req.query.cityId, req.query.cityName));
}

export async function listNeighborhoods(req, res) {
    res.json(await fetchNeighborhoods(req.query.districtId, req.query.districtName, req.query.cityName));
}
