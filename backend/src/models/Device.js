'use strict';

const { getPool, sql } = require('../config/database');

const Device = {
    /**
     * DeviceCode'a göre cihaz bulur (ESP32'nin gönderdiği deviceId).
     */
    async findByCode(deviceCode) {
        const pool = await getPool();
        const result = await pool.request()
            .input('DeviceCode', sql.NVarChar(50), deviceCode)
            .query(`
                SELECT Id, DeviceCode, LocationName, IpAddress, IsActive
                FROM dbo.Devices
                WHERE DeviceCode = @DeviceCode AND IsActive = 1
            `);
        return result.recordset[0] || null;
    },

    /**
     * Belirtilen kullanıcının belirtilen cihaza erişim yetkisi var mı?
     * ValidTo NULL ise süresiz yetki, yoksa tarih kontrolü yapılır.
     */
    async hasAccess(userId, deviceId) {
        const pool = await getPool();
        const result = await pool.request()
            .input('UserId',   sql.Int, userId)
            .input('DeviceId', sql.Int, deviceId)
            .query(`
                SELECT TOP 1 Id
                FROM dbo.AccessRules
                WHERE UserId   = @UserId
                  AND DeviceId = @DeviceId
                  AND ValidFrom <= SYSUTCDATETIME()
                  AND (ValidTo IS NULL OR ValidTo >= SYSUTCDATETIME())
            `);
        return result.recordset.length > 0;
    },
};

module.exports = Device;
