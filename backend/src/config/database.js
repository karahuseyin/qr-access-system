'use strict';

require('dotenv').config();
const sql = require('mssql');

const poolConfig = {
    server:   process.env.DB_SERVER || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 1433,
    database: process.env.DB_DATABASE || 'QRAccessControl',
    user:     process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    options: {
        encrypt:              process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERT !== 'false',
        enableArithAbort:     true,
    },
    pool: {
        max:            10,
        min:            2,
        idleTimeoutMillis: 30000,
    },
    requestTimeout: 15000,
};

let pool = null;

/**
 * Singleton bağlantı havuzu döndürür.
 * İlk çağrıda havuzu oluşturur, sonraki çağrılarda aynı örneği döndürür.
 */
async function getPool() {
    if (pool && pool.connected) return pool;

    try {
        pool = await sql.connect(poolConfig);
        console.log('[DB] SQL Server bağlantı havuzu oluşturuldu.');
        pool.on('error', (err) => {
            console.error('[DB] Havuz hatası:', err.message);
            pool = null; // Bir sonraki istekte yeniden bağlanacak
        });
        return pool;
    } catch (err) {
        pool = null;
        throw new Error(`[DB] Bağlantı hatası: ${err.message}`);
    }
}

/**
 * Havuzu kapatır (graceful shutdown için).
 */
async function closePool() {
    if (pool) {
        await pool.close();
        pool = null;
        console.log('[DB] Bağlantı havuzu kapatıldı.');
    }
}

module.exports = { getPool, closePool, sql };
