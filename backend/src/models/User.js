'use strict';

const { getPool, sql } = require('../config/database');

const User = {
    /**
     * E-posta adresine göre kullanıcı bulur.
     */
    async findByEmail(email) {
        const pool = await getPool();
        const result = await pool.request()
            .input('Email', sql.NVarChar(255), email)
            .query(`
                SELECT Id, Name, Email, SecretSeed, IsActive, CreatedAt
                FROM dbo.Users
                WHERE Email = @Email AND IsActive = 1
            `);
        return result.recordset[0] || null;
    },

    /**
     * ID'ye göre kullanıcı bulur.
     */
    async findById(id) {
        const pool = await getPool();
        const result = await pool.request()
            .input('Id', sql.Int, id)
            .query(`
                SELECT Id, Name, Email, SecretSeed, IsActive, CreatedAt
                FROM dbo.Users
                WHERE Id = @Id AND IsActive = 1
            `);
        return result.recordset[0] || null;
    },

    /**
     * Yeni kullanıcı kaydeder ve oluşturulan Id'yi döndürür.
     */
    async create({ name, email, secretSeed }) {
        const pool = await getPool();
        const result = await pool.request()
            .input('Name',       sql.NVarChar(150), name)
            .input('Email',      sql.NVarChar(255), email)
            .input('SecretSeed', sql.NVarChar(64),  secretSeed)
            .query(`
                INSERT INTO dbo.Users (Name, Email, SecretSeed, IsActive)
                OUTPUT INSERTED.Id, INSERTED.Name, INSERTED.Email, INSERTED.SecretSeed, INSERTED.CreatedAt
                VALUES (@Name, @Email, @SecretSeed, 1)
            `);
        return result.recordset[0];
    },

    /**
     * Kullanıcının SecretSeed değerini günceller.
     */
    async updateSecretSeed(userId, secretSeed) {
        const pool = await getPool();
        await pool.request()
            .input('Id',         sql.Int,           userId)
            .input('SecretSeed', sql.NVarChar(64),  secretSeed)
            .query(`
                UPDATE dbo.Users
                SET SecretSeed = @SecretSeed, UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @Id
            `);
    },
};

module.exports = User;
