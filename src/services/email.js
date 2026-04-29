function isEmailConfigured() {
    return false;
}

function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function sendMail({ to, subject }) {
    console.warn("[MAIL_DISABLED]", subject, to);
    return { ok: false, skipped: true };
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
