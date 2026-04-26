import { fetchCities, fetchDistricts, fetchNeighborhoods } from "../services/tkgmParcel.js";

export async function listCities(_req, res) {
    res.json(await fetchCities());
}

export async function listDistricts(req, res) {
    res.json(await fetchDistricts(req.query.cityId));
}

export async function listNeighborhoods(req, res) {
    res.json(await fetchNeighborhoods(req.query.districtId));
}
