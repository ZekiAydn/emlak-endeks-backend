// prisma/seed.cjs
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
    const username = "zeki.admin";
    const plainPassword = "123123123";

    const passwordHash = await bcrypt.hash(plainPassword, 10);

    const user = await prisma.user.upsert({
        where: { username },
        update: {
            passwordHash, // şifreyi güncel tutar
            role: "ADMIN",
            isActive: true,
        },
        create: {
            username,
            passwordHash,
            role: "ADMIN",
            isActive: true,
            fullName: "Admin",
            phone: null,
            email: null,
            about: "",
        },
        select: { id: true, username: true, role: true, fullName: true },
    });

    console.log("✅ Admin ready:", user);
}

main()
    .catch((e) => {
        console.error("❌ Seed error:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
