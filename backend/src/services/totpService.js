'use strict';

const { authenticator } = require('otplib');

// TOTP pencere ve adım ayarlarını .env'den oku
authenticator.options = {
    window: parseInt(process.env.TOTP_WINDOW) || 1,   // ±1 pencere = ±30 sn tolerans
    step:   parseInt(process.env.TOTP_STEP)   || 30,  // 30 saniyelik pencere
};

const TotpService = {
    /**
     * Yeni bir Base32 TOTP secret üretir.
     * @returns {string} Base32 encoded secret
     */
    generateSecret() {
        return authenticator.generateSecret(20); // 160-bit = 32 karakter Base32
    },

    /**
     * Gelen TOTP kodunun verilen secret ile geçerli olup olmadığını doğrular.
     * @param {string} token   - Kullanıcının gönderdiği 6 haneli kod
     * @param {string} secret  - Veritabanındaki SecretSeed
     * @returns {boolean}
     */
    verify(token, secret) {
        try {
            return authenticator.verify({ token: String(token), secret });
        } catch (err) {
            console.error('[TOTP] Doğrulama hatası:', err.message);
            return false;
        }
    },

    /**
     * QR payload string'ini kullanıcı ID ve TOTP koduna ayırır.
     * Beklenen format: "USERID:TOTPCODE" (örn: "USER123:847291")
     * @param {string} payload
     * @returns {{ userId: string, totpCode: string } | null}
     */
    parseQrPayload(payload) {
        if (!payload || typeof payload !== 'string') return null;

        const parts = payload.trim().split(':');
        if (parts.length !== 2) {
            console.warn('[TOTP] Geçersiz payload formatı:', payload);
            return null;
        }

        const [userId, totpCode] = parts;
        if (!userId || !totpCode || !/^\d{6}$/.test(totpCode)) {
            return null;
        }

        return { userId: userId.trim(), totpCode: totpCode.trim() };
    },
};

module.exports = TotpService;
