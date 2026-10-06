'use strict';

require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');

const { getPool, closePool } = require('./config/database');
const authRoutes   = require('./routes/authRoutes');
const accessRoutes = require('./routes/accessRoutes');

const app  = express();
const PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────────
//  MIDDLEWARE
// ──────────────────────────────────────────────

// CORS — üretim ortamında izin verilen origin'leri kısıtlayın
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST'],
}));

// JSON body parser (10kb limit — QR payload'ı küçük olacak)
app.use(express.json({ limit: '10kb' }));

// HTTP istek logları
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limiting — ESP32'den dakikada en fazla 100 istek
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
    max:      parseInt(process.env.RATE_LIMIT_MAX)       || 100,
    message:  { status: 'error', message: 'Çok fazla istek gönderildi.' },
    standardHeaders: true,
    legacyHeaders:   false,
});
app.use('/api/', limiter);

// ──────────────────────────────────────────────
//  ROUTES
// ──────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api/access', accessRoutes);

// Sağlık kontrolü endpoint'i
app.get('/health', async (_req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT SYSUTCDATETIME() AS ServerTime');
        return res.status(200).json({
            status:     'ok',
            serverTime: result.recordset[0].ServerTime,
        });
    } catch (err) {
        return res.status(503).json({ status: 'error', message: err.message });
    }
});

// 404 yakalama
app.use((_req, res) => {
    res.status(404).json({ status: 'error', message: 'Endpoint bulunamadı.' });
});

// Genel hata yönetimi
app.use((err, _req, res, _next) => {
    console.error('[APP] Yakalanmamış hata:', err);
    res.status(500).json({ status: 'error', message: 'Sunucu hatası.' });
});

// ──────────────────────────────────────────────
//  BAŞLATMA
// ──────────────────────────────────────────────
async function startServer() {
    try {
        await getPool(); // Veritabanı bağlantısını önceden hazırla
        app.listen(PORT, () => {
            console.log(`\n🚀 QR Geçiş API çalışıyor → http://localhost:${PORT}`);
            console.log(`📋 Sağlık kontrolü: http://localhost:${PORT}/health\n`);
        });
    } catch (err) {
        console.error('[APP] Başlatma hatası:', err.message);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[APP] SIGTERM alındı, kapatılıyor...');
    await closePool();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[APP] SIGINT alındı, kapatılıyor...');
    await closePool();
    process.exit(0);
});

startServer();

module.exports = app;
