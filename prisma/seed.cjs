// prisma/seed.cjs
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
    const username = process.env.ADMIN_USERNAME || "admin@zeki.com";
    const plainPassword = process.env.ADMIN_PASSWORD || "123123123";

    const passwordHash = await bcrypt.hash(plainPassword, 10);

    const user = await prisma.user.upsert({
        where: { username },
        update: {
            passwordHash, // şifreyi güncel tutar
            role: "ADMIN",
            isActive: true,
            subscriptionPlan: "PREMIUM_20_MONTHLY",
            subscriptionStatus: "ACTIVE",
            phoneVerifiedAt: new Date(),
        },
        create: {
            username,
            passwordHash,
            role: "ADMIN",
            isActive: true,
            subscriptionPlan: "PREMIUM_20_MONTHLY",
            subscriptionStatus: "ACTIVE",
            phoneVerifiedAt: new Date(),
            fullName: process.env.ADMIN_FULL_NAME || "Admin",
            phone: null,
            email: username.includes("@") ? username : null,
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
