const prisma = require("../prisma");
const { badRequest, notFound } = require("../utils/errors");

function cleanString(value) {
    return String(value || "").trim();
}

function cleanOptional(value) {
    const s = cleanString(value);
    return s || null;
}

function toFloatOrNull(value) {
    if (value === undefined || value === null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

const propertySelect = {
    id: true,
    clientId: true,
    title: true,
    addressText: true,
    parcelText: true,
    city: true,
    district: true,
    neighborhood: true,
    tkgmCity: true,
    tkgmDistrict: true,
    tkgmNeighborhood: true,
    blockNo: true,
    parcelNo: true,
    planInfo: true,
    landArea: true,
    landQuality: true,
    notes: true,
    createdAt: true,
    updatedAt: true,
};

function clientData(body = {}) {
    return {
        fullName: cleanString(body.fullName),
        phone: cleanOptional(body.phone),
        email: cleanOptional(body.email),
        notes: cleanOptional(body.notes),
    };
}

function propertyData(body = {}) {
    return {
        title: cleanOptional(body.title),
        addressText: cleanString(body.addressText),
        parcelText: cleanOptional(body.parcelText),
        city: cleanOptional(body.city),
        district: cleanOptional(body.district),
        neighborhood: cleanOptional(body.neighborhood),
        tkgmCity: cleanOptional(body.tkgmCity),
        tkgmDistrict: cleanOptional(body.tkgmDistrict),
        tkgmNeighborhood: cleanOptional(body.tkgmNeighborhood),
        blockNo: cleanOptional(body.blockNo),
        parcelNo: cleanOptional(body.parcelNo),
        planInfo: cleanOptional(body.planInfo),
        landArea: toFloatOrNull(body.landArea),
        landQuality: cleanOptional(body.landQuality),
        notes: cleanOptional(body.notes),
    };
}

async function findClientForUser(userId, id) {
    const client = await prisma.client.findFirst({ where: { id, userId } });
    if (!client) throw notFound("Müşteri bulunamadı.");
    return client;
}

async function findPropertyForUser(userId, id) {
    const property = await prisma.property.findFirst({
        where: { id, userId },
        include: { client: true },
    });
    if (!property) throw notFound("Taşınmaz bulunamadı.");
    return property;
}

exports.listClients = async (req, res) => {
    const userId = req.user.userId;
    const q = cleanString(req.query.q);
    const take = Math.min(Number(req.query.take || 50), 100);
    const skip = Number(req.query.skip || 0);

    const clients = await prisma.client.findMany({
        where: {
            userId,
            ...(q
                ? {
                    OR: [
                        { fullName: { contains: q, mode: "insensitive" } },
                        { phone: { contains: q, mode: "insensitive" } },
                        { email: { contains: q, mode: "insensitive" } },
                    ],
                }
                : {}),
        },
        orderBy: { updatedAt: "desc" },
        take,
        skip,
        include: {
            _count: { select: { properties: true, reports: true } },
        },
    });

    res.json(clients);
};

exports.createClient = async (req, res) => {
    const userId = req.user.userId;
    const data = clientData(req.body);
    if (!data.fullName) throw badRequest("Müşteri adı soyadı gerekli.", "fullName");

    const client = await prisma.client.create({ data: { ...data, userId } });
    res.status(201).json(client);
};

exports.getClient = async (req, res) => {
    const userId = req.user.userId;
    const client = await prisma.client.findFirst({
        where: { id: req.params.id, userId },
        include: {
            properties: { orderBy: { updatedAt: "desc" }, select: propertySelect },
            reports: {
                orderBy: { createdAt: "desc" },
                take: 20,
                select: { id: true, clientFullName: true, addressText: true, reportDate: true, createdAt: true },
            },
        },
    });
    if (!client) throw notFound("Müşteri bulunamadı.");
    res.json(client);
};

exports.updateClient = async (req, res) => {
    const userId = req.user.userId;
    await findClientForUser(userId, req.params.id);

    const data = clientData(req.body);
    if (!data.fullName) throw badRequest("Müşteri adı soyadı gerekli.", "fullName");

    const client = await prisma.client.update({
        where: { id: req.params.id },
        data,
    });

    res.json(client);
};

exports.deleteClient = async (req, res) => {
    const userId = req.user.userId;
    await findClientForUser(userId, req.params.id);
    await prisma.client.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
};

exports.listClientProperties = async (req, res) => {
    const userId = req.user.userId;
    await findClientForUser(userId, req.params.id);

    const properties = await prisma.property.findMany({
        where: { userId, clientId: req.params.id },
        orderBy: { updatedAt: "desc" },
        select: propertySelect,
    });

    res.json(properties);
};

exports.createClientProperty = async (req, res) => {
    const userId = req.user.userId;
    const client = await findClientForUser(userId, req.params.id);
    const data = propertyData(req.body);
    if (!data.addressText) throw badRequest("Taşınmaz adresi gerekli.", "addressText");

    const property = await prisma.property.create({
        data: { ...data, userId, clientId: client.id },
        select: propertySelect,
    });

    res.status(201).json(property);
};

exports.getProperty = async (req, res) => {
    const property = await findPropertyForUser(req.user.userId, req.params.id);
    res.json(property);
};

exports.updateProperty = async (req, res) => {
    const userId = req.user.userId;
    await findPropertyForUser(userId, req.params.id);
    const data = propertyData(req.body);
    if (!data.addressText) throw badRequest("Taşınmaz adresi gerekli.", "addressText");

    const property = await prisma.property.update({
        where: { id: req.params.id },
        data,
        select: propertySelect,
    });

    res.json(property);
};

exports.deleteProperty = async (req, res) => {
    const userId = req.user.userId;
    await findPropertyForUser(userId, req.params.id);
    await prisma.property.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
};
