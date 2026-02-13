const prisma = require("../prisma");

// Tek kullanıcı bootstrap: yoksa oluştur
exports.bootstrap = async (req, res) => {
    const existing = await prisma.user.findFirst();
    if (existing) return res.json(existing);

    const user = await prisma.user.create({
        data: {
            fullName: "Emlakçı Ad Soyad",
            phone: "",
            email: "",
            about: ""
        }
    });

    res.json(user);
};

const mediaSelect = {
    id: true, type: true, mime: true, filename: true, order: true, createdAt: true, userId: true, reportId: true
};

exports.getMe = async (req, res) => {
    const user = await prisma.user.findFirst({
        include: { media: { orderBy: { order: "asc" }, select: mediaSelect } }
    });
    if (!user) return res.status(404).json({ error: "No user. Run POST /bootstrap" });
    res.json(user);
};

exports.updateMe = async (req, res) => {
    const user = await prisma.user.findFirst();
    if (!user) return res.status(404).json({ error: "No user. Run POST /bootstrap" });

    const { fullName, phone, email, about } = req.body || {};

    const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
            fullName: fullName ?? user.fullName,
            phone: phone ?? user.phone,
            email: email ?? user.email,
            about: about ?? user.about
        }
    });

    res.json(updated);
};
