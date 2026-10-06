'use strict';

const { getPool, sql } = require('../config/database');

const AccessLog = {
    /**
     * Geçiş kaydı oluşturur.
     * @param {object} entry
     * @param {number|null} entry.userId     - Kullanıcı Id (bilinmiyorsa null)
     * @param {number|null} entry.deviceId   - Cihaz Id (bilinmiyorsa null)
     * @param {string}      entry.qrPayload  - Ham QR metni
     * @param {boolean}     entry.isGranted  - Geçiş onaylandı mı?
     * @param {string|null} entry.failReason - Red nedeni (opsiyonel)
     */
    async create({ userId, deviceId, qrPayload, isGranted, failReason = null }) {
        const pool = await getPool();
        const result = await pool.request()
            .input('UserId',     sql.Int,           userId)
            .input('DeviceId',   sql.Int,           deviceId)
            .input('QrPayload',  sql.NVarChar(512),  qrPayload)
            .input('IsGranted',  sql.Bit,            isGranted ? 1 : 0)
            .input('FailReason', sql.NVarChar(500),  failReason)
            .query(`
                INSERT INTO dbo.AccessLogs
                    (UserId, DeviceId, QrPayload, AccessTime, IsGranted, FailReason)
                OUTPUT INSERTED.Id, INSERTED.AccessTime
                VALUES
                    (@UserId, @DeviceId, @QrPayload, SYSUTCDATETIME(), @IsGranted, @FailReason)
            `);
        return result.recordset[0];
    },

    /**
     * Belirli bir kullanıcının son N geçiş kaydını listeler.
     */
    async findByUser(userId, limit = 50) {
        const pool = await getPool();
        const result = await pool.request()
            .input('UserId', sql.Int, userId)
            .input('Limit',  sql.Int, limit)
            .query(`
                SELECT TOP (@Limit)
                    al.Id, al.AccessTime, al.IsGranted, al.FailReason,
                    d.DeviceCode, d.LocationName
                FROM dbo.AccessLogs al
                LEFT JOIN dbo.Devices d ON al.DeviceId = d.Id
                WHERE al.UserId = @UserId
                ORDER BY al.AccessTime DESC
            `);
        return result.recordset;
    },
};

module.exports = AccessLog;
