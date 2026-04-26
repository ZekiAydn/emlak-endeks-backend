import { paymentRequired } from "../utils/errors.js";
import { isPhoneVerificationConfigured } from "./phoneVerification.js";

const PLAN_DEFINITIONS = {
    FREE: {
        key: "FREE",
        name: "Ücretsiz",
        billingInterval: "FREE",
        monthlyReportLimit: 3,
    },
    PREMIUM_20_MONTHLY: {
        key: "PREMIUM_20_MONTHLY",
        name: "Aylık Abone",
        billingInterval: "MONTHLY",
        monthlyReportLimit: 20,
    },
    PREMIUM_20_YEARLY: {
        key: "PREMIUM_20_YEARLY",
        name: "Yıllık Abone",
        billingInterval: "YEARLY",
        monthlyReportLimit: 20,
    },
};

const DEFAULT_PLAN = "FREE";

function monthBounds(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    return {
        start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
        end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
    };
}

function planForUser(user = {}) {
    return PLAN_DEFINITIONS[user.subscriptionPlan] || PLAN_DEFINITIONS[DEFAULT_PLAN];
}

function paymentUrlForPlan(key) {
    return process.env[`${key}_PAYMENT_URL`] || null;
}

function publicPlans() {
    return Object.values(PLAN_DEFINITIONS).map((plan) => ({
        ...plan,
        paymentUrl: plan.key === "FREE" ? null : paymentUrlForPlan(plan.key),
    }));
}

async function getSubscriptionSummary(prisma, userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            subscriptionPlan: true,
            subscriptionStatus: true,
            phone: true,
            phoneVerifiedAt: true,
            role: true,
        },
    });

    if (!user) return null;

    const plan = planForUser(user);
    const { start, end } = monthBounds();
    const usedThisMonth = await prisma.report.count({
        where: {
            userId,
            createdAt: {
                gte: start,
                lt: end,
            },
        },
    });

    const phoneVerified = user.role === "ADMIN" || Boolean(user.phone && user.phoneVerifiedAt);
    const limit = user.subscriptionStatus === "ACTIVE" && phoneVerified ? plan.monthlyReportLimit : 0;

    return {
        status: user.subscriptionStatus || "ACTIVE",
        plan: plan.key,
        planName: plan.name,
        billingInterval: plan.billingInterval,
        phoneVerified,
        phoneVerifiedAt: user.phoneVerifiedAt ? user.phoneVerifiedAt.toISOString() : null,
        requiresPhoneVerification: !phoneVerified,
        phoneVerificationEnabled: isPhoneVerificationConfigured(),
        monthlyReportLimit: limit,
        usedThisMonth,
        remainingThisMonth: Math.max(0, limit - usedThisMonth),
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        plans: publicPlans(),
    };
}

async function assertCanCreateReport(prisma, userId) {
    const summary = await getSubscriptionSummary(prisma, userId);
    if (!summary) return;

    if (summary.status !== "ACTIVE") {
        throw paymentRequired("Aktif abonelik bulunamadı. Rapor oluşturmak için bir paket seçmelisiniz.");
    }

    if (summary.requiresPhoneVerification) {
        throw paymentRequired("Telefon numaranız doğrulanmadan rapor hakkı kullanılamaz.");
    }

    if (summary.usedThisMonth >= summary.monthlyReportLimit) {
        throw paymentRequired(`Aylık rapor hakkınız doldu (${summary.monthlyReportLimit}/${summary.monthlyReportLimit}).`);
    }
}

export {
    DEFAULT_PLAN,
    PLAN_DEFINITIONS,
    assertCanCreateReport,
    getSubscriptionSummary,
    publicPlans,
};
