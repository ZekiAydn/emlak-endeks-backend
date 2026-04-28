import nodemailer from "nodemailer";

const FROM_EMAIL = process.env.MAIL_FROM || process.env.SMTP_FROM || "info@emlakskor.com";
const FROM_NAME = process.env.MAIL_FROM_NAME || "EmlakSkor";

function isEmailConfigured() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transporter() {
    if (!isEmailConfigured()) return null;

    const port = Number(process.env.SMTP_PORT || 587);
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function sendMail({ to, subject, text, html }) {
    const mailer = transporter();
    if (!mailer) {
        console.warn("[MAIL_DISABLED]", subject, to);
        return { ok: false, skipped: true };
    }

    await mailer.sendMail({
        from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
        to,
        subject,
        text,
        html,
    });

    return { ok: true };
}

async function sendTemporaryPasswordEmail({ to, fullName, temporaryPassword }) {
    const subject = "EmlakSkor geçici şifreniz";
    const safeName = fullName || "EmlakSkor kullanıcısı";
    const htmlName = escapeHtml(safeName);
    const htmlPassword = escapeHtml(temporaryPassword);
    const text = [
        `Merhaba ${safeName},`,
        "",
        "Şifre sıfırlama talebiniz için hesabınıza geçici bir şifre oluşturuldu.",
        "",
        `Geçici şifre: ${temporaryPassword}`,
        "",
        "Bu şifreyle giriş yaptıktan sonra Profil > Profil Düzenle ekranından kendi şifrenizi belirleyin.",
        "",
        "Bu işlemi siz başlatmadıysanız lütfen info@emlakskor.com adresine yazın.",
    ].join("\n");

    const html = `
        <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">
            <h2>EmlakSkor geçici şifreniz</h2>
            <p>Merhaba ${htmlName},</p>
            <p>Şifre sıfırlama talebiniz için hesabınıza geçici bir şifre oluşturuldu.</p>
            <p style="font-size:18px"><strong>${htmlPassword}</strong></p>
            <p>Bu şifreyle giriş yaptıktan sonra Profil &gt; Profil Düzenle ekranından kendi şifrenizi belirleyin.</p>
            <p>Bu işlemi siz başlatmadıysanız lütfen <a href="mailto:info@emlakskor.com">info@emlakskor.com</a> adresine yazın.</p>
        </div>
    `;

    return sendMail({ to, subject, text, html });
}

export {
    isEmailConfigured,
    sendMail,
    sendTemporaryPasswordEmail,
};
