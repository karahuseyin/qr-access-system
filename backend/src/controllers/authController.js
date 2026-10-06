'use strict';

const User       = require('../models/User');
const TotpService = require('../services/totpService');

const AuthController = {
    /**
     * POST /api/auth/register-device
     * 
     * Yeni kullanıcı kaydeder veya mevcut kullanıcının seed'ini yeniler.
     * PWA ilk açılışında bu endpoint'e istek atar.
     * 
     * Body: { name: string, email: string }
     * Response: { userId, email, secretSeed, totpUri }
     */
    async registerDevice(req, res) {
        const { name, email } = req.body;

        // Giriş doğrulama
        if (!name || !email) {
            return res.status(400).json({
                status: 'error',
                message: 'name ve email alanları zorunludur.',
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                status: 'error',
                message: 'Geçerli bir e-posta adresi girin.',
            });
        }

        try {
            let user = await User.findByEmail(email);

            const secretSeed = TotpService.generateSecret();

            if (user) {
                // Mevcut kullanıcının secret'ını yenile (cihaz sıfırlama)
                await User.updateSecretSeed(user.Id, secretSeed);
                user.SecretSeed = secretSeed;
                console.log(`[AUTH] Kullanıcı seed yenilendi: ${email}`);
            } else {
                // Yeni kullanıcı oluştur
                user = await User.create({ name, email, secretSeed });
                console.log(`[AUTH] Yeni kullanıcı kaydedildi: ${email}`);
            }

            // TOTP URI (Google Authenticator uyumlu, opsiyonel kullanım)
            const totpUri = `otpauth://totp/QRAccess:${encodeURIComponent(email)}?secret=${secretSeed}&issuer=QRAccessControl&algorithm=SHA1&digits=6&period=30`;

            return res.status(200).json({
                status: 'success',
                data: {
                    userId:     user.Id,
                    name:       user.Name || name,
                    email:      user.Email || email,
                    secretSeed, // PWA'da localStorage'a kaydedilecek
                    totpUri,    // Opsiyonel: QR ile auth app bağlama
                },
            });
        } catch (err) {
            console.error('[AUTH] Kayıt hatası:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Sunucu hatası oluştu.',
            });
        }
    },
};

module.exports = AuthController;
