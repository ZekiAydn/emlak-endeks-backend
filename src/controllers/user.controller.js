const prisma = require("../prisma");

const mediaSelect = {
    id: true, type: true, mime: true, filename: true, order: true, createdAt: true, userId: true, reportId: true
};

exports.getMe = async (req, res) => {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { media: { orderBy: { order: "asc" }, select: mediaSelect } }
    });

    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
};

exports.updateMe = async (req, res) => {
    const userId = req.user.userId;

    const { fullName, phone, email, about } = req.body || {};

    const updated = await prisma.user.update({
        where: { id: userId },
        data: { fullName, phone, email, about }
    });

    res.json(updated);
};
