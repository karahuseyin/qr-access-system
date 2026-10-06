'use strict';

const User        = require('../models/User');
const Device      = require('../models/Device');
const AccessLog   = require('../models/AccessLog');
const TotpService = require('../services/totpService');

const AccessController = {
    /**
     * POST /api/access/verify
     * 
     * ESP32 cihazından gelen QR doğrulama isteğini işler.
     * 
     * Body: { deviceId: string, qrPayload: string }
     * 
     * Başarı:  HTTP 200 { status: "success", open: true }
     * Ret:     HTTP 403 { status: "denied",  reason: string }
     */
    async verify(req, res) {
        const { deviceId, qrPayload } = req.body;

        // ── 1. Giriş doğrulama ──────────────────────────────
        if (!deviceId || !qrPayload) {
            return res.status(400).json({
                status:  'error',
                message: 'deviceId ve qrPayload alanları zorunludur.',
            });
        }

        // Log için paylaşılan değişkenler
        let dbUserId   = null;
        let dbDeviceId = null;

        const deny = async (reason, statusCode = 403) => {
            console.warn(`[ACCESS] REDDEDİLDİ | Device: ${deviceId} | Neden: ${reason}`);
            await AccessLog.create({
                userId:    dbUserId,
                deviceId:  dbDeviceId,
                qrPayload,
                isGranted: false,
                failReason: reason,
            }).catch(logErr => console.error('[ACCESS] Log yazma hatası:', logErr));

            return res.status(statusCode).json({ status: 'denied', reason });
        };

        try {
            // ── 2. Cihaz doğrulama ──────────────────────────
            const device = await Device.findByCode(deviceId);
            if (!device) {
                return deny('UNKNOWN_DEVICE');
            }
            dbDeviceId = device.Id;

            // ── 3. QR payload ayrıştırma ────────────────────
            const parsed = TotpService.parseQrPayload(qrPayload);
            if (!parsed) {
                return deny('INVALID_PAYLOAD_FORMAT');
            }
            const { userId: rawUserId, totpCode } = parsed;

            // ── 4. Kullanıcı doğrulama ──────────────────────
            // userId numerik ise Id ile, değilse email ile ara
            let user;
            if (/^\d+$/.test(rawUserId)) {
                user = await User.findById(parseInt(rawUserId, 10));
            } else {
                user = await User.findByEmail(rawUserId);
            }

            if (!user) {
                return deny('USER_NOT_FOUND');
            }
            dbUserId = user.Id;

            // ── 5. TOTP doğrulama ───────────────────────────
            const isValidTotp = TotpService.verify(totpCode, user.SecretSeed);
            if (!isValidTotp) {
                return deny('INVALID_TOTP');
            }

            // ── 6. Yetki kontrolü ───────────────────────────
            const hasPermission = await Device.hasAccess(user.Id, device.Id);
            if (!hasPermission) {
                return deny('NO_PERMISSION');
            }

            // ── 7. Başarılı geçiş — log yaz ve yanıt dön ───
            await AccessLog.create({
                userId:    user.Id,
                deviceId:  device.Id,
                qrPayload,
                isGranted: true,
                failReason: null,
            });

            console.log(
                `[ACCESS] ONAYLANDI | Kullanıcı: ${user.Email} | Cihaz: ${device.LocationName}`
            );

            return res.status(200).json({
                status: 'success',
                open:   true,
                data: {
                    userName:     user.Name,
                    locationName: device.LocationName,
                },
            });

        } catch (err) {
            console.error('[ACCESS] Sunucu hatası:', err);
            return res.status(500).json({
                status:  'error',
                message: 'Sunucu hatası oluştu.',
            });
        }
    },
};

module.exports = AccessController;
