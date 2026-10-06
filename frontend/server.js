/**
 * QR Geçiş Sistemi — PWA statik sunucu
 *
 * Tek amaç: frontend/public klasörünü hem HTTP hem HTTPS üzerinden servis etmek.
 *   - HTTPS : PWA kurulumu (manifest + service worker) için ŞART.
 *   - HTTP  : hızlı masaüstü testi ve ESP32'nin yerel ağ erişimi için.
 *
 * İlk çalıştırmada frontend/certs/ altına kendi kendine imzalı sertifika
 * üretilir (harici bağımlılık: selfsigned). Tarayıcı sertifikaya bir kez
 * "Gelişmiş → Risksini kabul ederek devam et" demelidir — LAN içi kullanım
 * için normaldir.
 *
 * Kullanım:
 *   npm install
 *   npm start                 → http://0.0.0.0:8080 + https://0.0.0.0:8443
 *   HTTP_PORT=8080 HTTPS_PORT=8443 npm start   (port değiştirmek için)
 *   Sertifikayı yeniden üretmek için certs/ klasörünü silin.
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const selfsigned = require('selfsigned');

const PUBLIC_DIR = path.join(__dirname, 'public');
const CERT_DIR = path.join(__dirname, 'certs');
const HTTP_PORT = parseInt(process.env.HTTP_PORT, 10) || 8080;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || 8443;
// /api istekleri buradan backend'e aktarılır (telefon tek adres kullanır,
// mixed-content ve CORS sorunları yaşanmaz). ESP32 doğrudan backend'e gider.
const API_TARGET_HOST = process.env.API_TARGET_HOST || '127.0.0.1';
const API_TARGET_PORT = parseInt(process.env.API_TARGET_PORT, 10) || 3000;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2',
};

// ── Sertifika ────────────────────────────────────────────────
function localIPv4s() {
    const result = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const ni of list || []) {
            if (ni.family === 'IPv4' && !ni.internal) result.push(ni.address);
        }
    }
    return result;
}

function ensureCerts() {
    const keyFile = path.join(CERT_DIR, 'key.pem');
    const certFile = path.join(CERT_DIR, 'cert.pem');
    if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
        return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
    }
    console.log('[CERT] Kendi kendine imzalı sertifika üretiliyor...');
    // NOT: forge IP alt isimlerinde `value` DEĞİL `ip` alanını okur
    // (`type === 7 && altName.ip`). `value` kullanılırsa IP string'i ham
    // bayt gibi kodlanır ve Chrome sertifikayı ERR_CERT_INVALID ile reddeder.
    const ips = localIPv4s();
    const altNames = [
        { type: 2, value: 'localhost' },     // DNS
        { type: 7, ip: '127.0.0.1' },
        ...ips.map((ip) => ({ type: 7, ip })),
    ];
    const pems = selfsigned.generate(
        [{ name: 'commonName', value: 'qr-access.local' }],
        {
            keySize: 2048,
            algorithm: 'sha256',
            days: 825,
            extensions: [
                { name: 'basicConstraints', cA: false, critical: true },
                { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
                { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
                { name: 'subjectAltName', altNames },
            ],
        }
    );
    fs.mkdirSync(CERT_DIR, { recursive: true });
    fs.writeFileSync(keyFile, pems.private);
    fs.writeFileSync(certFile, pems.cert);
    console.log(`[CERT] Sertifika yazıldı: ${CERT_DIR}`);
    return { key: pems.private, cert: pems.cert };
}

// ── /api → backend proxy ─────────────────────────────────────
function proxyApi(req, res) {
    const options = {
        host: API_TARGET_HOST,
        port: API_TARGET_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `${API_TARGET_HOST}:${API_TARGET_PORT}` },
    };
    const upstream = http.request(options, (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
    });
    upstream.on('error', (err) => {
        console.error('[PROXY] Backend erişilemiyor:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'error', message: 'Backend servise ulaşilamadi (kapali olabilir).' }));
    });
    req.pipe(upstream);
}

// ── Statik dosya handler'ı ───────────────────────────────────
function serveStatic(req, res) {
    const urlPath = new URL(req.url, 'http://x').pathname;
    if (urlPath === '/api/' || urlPath.startsWith('/api/')) {
        return proxyApi(req, res);
    }
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath);
    } catch (_) {
        res.writeHead(400); return res.end('Bad Request');
    }
    if (decoded === '/') decoded = '/index.html';

    const filePath = path.normalize(path.join(PUBLIC_DIR, decoded));
    if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
        res.writeHead(403); return res.end('Forbidden');
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('404 — Dosya bulunamadı');
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Content-Length': stat.size,
            'Cache-Control': 'no-cache', // SW güncellemelerini geciktirmesin
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

// ── Başlatma ─────────────────────────────────────────────────
const credentials = ensureCerts();

http.createServer(serveStatic).listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[HTTP ] http://localhost:${HTTP_PORT}  (yalnızca test — PWA kurulumu yapmaz)`);
});

// Birincil HTTPS portu
https.createServer(credentials, serveStatic).listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`[HTTPS] https://localhost:${HTTPS_PORT}  (PWA kurulumu için bunu kullanın)`);
    for (const ip of localIPv4s()) {
        console.log(`[HTTPS] https://${ip}:${HTTPS_PORT}  ← telefondan bu adresi açın`);
    }
    console.log('');
    console.log('Telefonda ilk ziyarette sertifika uyarısını onaylayın,');
    console.log('ardından "Uygulamayı Yükle" ile PWA\'yı kurun. Sonrası tamamen offline çalışır.');
});

// Kolaylık: 443 boşsa orada da dinle — telefon "https://<ip>" yazarak da ulaşır
const srv443 = https.createServer(credentials, serveStatic);
srv443.on('error', () => {}); // meşgulse sessizce geç (443 yerine 8443 kullanılır)
srv443.listen(443, '0.0.0.0', () => {
    for (const ip of localIPv4s()) {
        console.log(`[HTTPS] https://${ip}  (443 de açık — portsuz adres de çalışır)`);
    }
});
