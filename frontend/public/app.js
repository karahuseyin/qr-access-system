/**
 * ============================================================
 *  QR Geçiş Sistemi — PWA Ana Uygulama (Vanilla JS)
 *
 *  TOTP'yi tarayıcıda üretmek için iki seçenek vardır:
 *
 *  1) /lib/totp.min.js (önerilen — offline çalışır):
 *     Otpauth kütüphanesinin tarayıcı UMD build'i.
 *     Kaynak: https://github.com/hectorm/otpauth
 *     İndirip /lib/totp.min.js olarak kaydedin.
 *
 *  2) Web Crypto API + manuel TOTP (yedek — aşağıda gömülü):
 *     Dışa bağımlılık yok, Service Worker ile tam offline.
 * ============================================================
 */

'use strict';

// ──────────────────────────────────────────────
//  YEDEK TOTP — Web Crypto API (Pure JS, offline)
// ──────────────────────────────────────────────
const FallbackTOTP = {
    /**
     * Base32 decode
     */
    base32Decode(encoded) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const cleanStr = encoded.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
        let bits = 0, value = 0;
        const output = [];

        for (let i = 0; i < cleanStr.length; i++) {
            const idx = alphabet.indexOf(cleanStr[i]);
            if (idx < 0) continue;
            value = (value << 5) | idx;
            bits += 5;
            if (bits >= 8) {
                bits -= 8;
                output.push((value >>> bits) & 0xFF);
            }
        }
        return new Uint8Array(output);
    },

    /**
     * HMAC-SHA1 hesapla
     */
    async hmacSha1(keyBytes, msgBytes) {
        const cryptoKey = await crypto.subtle.importKey(
            'raw', keyBytes,
            { name: 'HMAC', hash: 'SHA-1' },
            false, ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
        return new Uint8Array(signature);
    },

    /**
     * 6 haneli TOTP kodu üret (RFC 6238)
     * @param {string} secret  - Base32 encoded secret
     * @param {number} [step]  - Pencere uzunluğu (varsayılan: 30 sn)
     * @returns {Promise<string>} 6 haneli kod (başında 0 olabilir)
     */
    async generate(secret, step = 30) {
        const keyBytes = this.base32Decode(secret);
        const time     = Math.floor(Date.now() / 1000 / step);

        // Counter'ı Big-Endian 8 bayt olarak kodla
        const counter  = new Uint8Array(8);
        let tmp = time;
        for (let i = 7; i >= 0; i--) {
            counter[i] = tmp & 0xFF;
            tmp = Math.floor(tmp / 256);
        }

        const hmac   = await this.hmacSha1(keyBytes, counter);
        const offset = hmac[19] & 0x0F;
        const code   = (
            ((hmac[offset]     & 0x7F) << 24) |
            ((hmac[offset + 1] & 0xFF) << 16) |
            ((hmac[offset + 2] & 0xFF) << 8)  |
            ((hmac[offset + 3] & 0xFF))
        ) % 1_000_000;

        return String(code).padStart(6, '0');
    },
};

// ──────────────────────────────────────────────
//  TOTP ADAPTÖR — önce otpauth kütüphanesini dene
// ──────────────────────────────────────────────
const TOTP = {
    async generate(secret) {
        try {
            // otpauth UMD kütüphanesi yüklendiyse kullan
            if (window.OTPAuth) {
                const totp = new window.OTPAuth.TOTP({ secret, digits: 6, period: 30 });
                return totp.generate();
            }
        } catch (_) { /* yedek yönteme düş */ }

        return FallbackTOTP.generate(secret, 30);
    },
};

// ──────────────────────────────────────────────
//  STORAGE — localStorage üzerinde soyutlama
// ──────────────────────────────────────────────
const Store = {
    KEYS: {
        USER_ID:     'qr_userId',
        USER_NAME:   'qr_userName',
        SECRET_SEED: 'qr_secretSeed',
        SERVER_URL:  'qr_serverUrl',
    },

    save({ userId, userName, secretSeed, serverUrl }) {
        try {
            localStorage.setItem(this.KEYS.USER_ID,     String(userId));
            localStorage.setItem(this.KEYS.USER_NAME,   userName);
            localStorage.setItem(this.KEYS.SECRET_SEED, secretSeed);
            localStorage.setItem(this.KEYS.SERVER_URL,  serverUrl);
        } catch (e) {
            console.error('[Store] Yazma hatası:', e);
        }
    },

    load() {
        try {
            return {
                userId:     localStorage.getItem(this.KEYS.USER_ID),
                userName:   localStorage.getItem(this.KEYS.USER_NAME),
                secretSeed: localStorage.getItem(this.KEYS.SECRET_SEED),
                serverUrl:  localStorage.getItem(this.KEYS.SERVER_URL),
            };
        } catch (e) {
            return {};
        }
    },

    clear() {
        Object.values(this.KEYS).forEach((k) => localStorage.removeItem(k));
    },

    isReady() {
        const { userId, secretSeed } = this.load();
        return !!(userId && secretSeed);
    },
};

// ──────────────────────────────────────────────
//  QR KOD ÜRETİCİ
// ──────────────────────────────────────────────
let qrInstance = null;

function renderQR(payload) {
    const container = document.getElementById('qr-container');
    container.innerHTML = '';

    if (window.QRCode) {
        qrInstance = new window.QRCode(container, {
            text:          payload,
            width:         220,
            height:        220,
            colorDark:     '#000000',
            colorLight:    '#ffffff',
            correctLevel:  window.QRCode.CorrectLevel.M,
        });
    } else {
        // QRCode.js yüklenmemişse metin göster
        container.style.cssText = 'font-family:monospace;font-size:0.75rem;color:#000;background:#fff;padding:16px;word-break:break-all;max-width:220px;';
        container.textContent = payload;
    }
}

// ──────────────────────────────────────────────
//  ZAMANLAYICI & KOD DÖNGÜSÜ
// ──────────────────────────────────────────────
const STEP_MS = 30_000; // 30 saniye

let tickInterval    = null;
let currentUserId   = null;
let currentSecret   = null;

async function updateQR() {
    if (!currentSecret || !currentUserId) return;

    try {
        const code    = await TOTP.generate(currentSecret);
        const payload = `${currentUserId}:${code}`;

        renderQR(payload);

        // UI güncelle
        document.getElementById('current-code').textContent = code;

        const badge = document.getElementById('status-badge');
        badge.textContent = 'Hazır';
        badge.className   = 'badge badge-ok';
    } catch (err) {
        console.error('[QR] Kod üretme hatası:', err);
        const badge = document.getElementById('status-badge');
        badge.textContent = 'Hata';
        badge.className   = 'badge badge-error';
    }
}

function startTimer() {
    clearInterval(tickInterval);

    const progressBar  = document.getElementById('progress-bar');
    const countdownEl  = document.getElementById('countdown');

    function tick() {
        const now      = Date.now();
        const elapsed  = now % STEP_MS;           // Bu pencerede geçen ms
        const remaining = Math.ceil((STEP_MS - elapsed) / 1000); // Kalan saniye
        const fillPct  = ((STEP_MS - elapsed) / STEP_MS) * 100;  // Doluluğu

        countdownEl.textContent   = remaining;
        progressBar.style.width   = `${fillPct}%`;

        // Pencere değişiminde yeni kod üret (sıfır geçişi)
        if (remaining === 30) {
            updateQR();
        }
    }

    // İlk kodu hemen üret
    updateQR();
    tick();

    // Her saniye güncelle
    tickInterval = setInterval(tick, 1000);
}

function stopTimer() {
    clearInterval(tickInterval);
    tickInterval = null;
}

// ──────────────────────────────────────────────
//  EKRAN YÖNETİMİ
// ──────────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ──────────────────────────────────────────────
//  GİRİŞ / KAYIT
// ──────────────────────────────────────────────
async function handleRegister() {
    const name      = document.getElementById('input-name').value.trim();
    const email     = document.getElementById('input-email').value.trim();
    const serverUrl = document.getElementById('input-server').value.trim().replace(/\/$/, '');
    const errorEl   = document.getElementById('login-error');
    const btnEl     = document.getElementById('btn-register');

    errorEl.classList.add('hidden');
    errorEl.textContent = '';

    if (!name || !email || !serverUrl) {
        errorEl.textContent = 'Tüm alanları doldurun.';
        errorEl.classList.remove('hidden');
        return;
    }

    btnEl.disabled = true;
    btnEl.classList.add('loading');

    try {
        const response = await fetch(`${serverUrl}/api/auth/register-device`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email }),
        });

        const data = await response.json();

        if (!response.ok || data.status !== 'success') {
            throw new Error(data.message || 'Kayıt başarısız.');
        }

        // Verileri kaydet
        Store.save({
            userId:     data.data.userId,
            userName:   data.data.name,
            secretSeed: data.data.secretSeed,
            serverUrl,
        });

        initQRScreen({
            userId:     data.data.userId,
            userName:   data.data.name,
            secretSeed: data.data.secretSeed,
        });

    } catch (err) {
        errorEl.textContent = `Bağlantı hatası: ${err.message}`;
        errorEl.classList.remove('hidden');
    } finally {
        btnEl.disabled = false;
        btnEl.classList.remove('loading');
    }
}

// ──────────────────────────────────────────────
//  QR EKRANINI BAŞLAT
// ──────────────────────────────────────────────
function initQRScreen({ userId, userName, secretSeed }) {
    currentUserId  = userId;
    currentSecret  = secretSeed;

    document.getElementById('header-username').textContent = userName || 'Kullanıcı';

    showScreen('screen-qr');
    startTimer();

    // Online/offline badge
    updateOnlineBadge();
}

function updateOnlineBadge() {
    const badge = document.getElementById('offline-badge');
    if (navigator.onLine) {
        badge.classList.add('hidden');
    } else {
        badge.classList.remove('hidden');
    }
}

// ──────────────────────────────────────────────
//  ÇIKIŞ
// ──────────────────────────────────────────────
function handleLogout() {
    if (!confirm('Cihaz kaydı silinecek. Devam etmek istiyor musunuz?')) return;
    stopTimer();
    Store.clear();
    currentUserId  = null;
    currentSecret  = null;
    showScreen('screen-login');
}

// ──────────────────────────────────────────────
//  UYGULAMA BAŞLANGICI
// ──────────────────────────────────────────────
function init() {
    // Service Worker kaydı
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then((reg) => console.log('[SW] Kayıtlı:', reg.scope))
            .catch((err) => console.warn('[SW] Kayıt hatası:', err));
    }

    // Olay dinleyicileri
    document.getElementById('btn-register').addEventListener('click', handleRegister);
    document.getElementById('btn-logout').addEventListener('click', handleLogout);

    // Enter tuşu ile kayıt
    document.getElementById('input-server').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleRegister();
    });

    // Online/offline olayları
    window.addEventListener('online',  updateOnlineBadge);
    window.addEventListener('offline', updateOnlineBadge);

    // Sayfa görünürlük değişikliği — sekmeye dönüldüğünde kodu güncelle
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && currentSecret) {
            updateQR();
        }
    });

    // Kayıtlı oturum var mı?
    if (Store.isReady()) {
        const { userId, userName, secretSeed } = Store.load();
        initQRScreen({ userId, userName, secretSeed });
    } else {
        showScreen('screen-login');
    }
}

// Fallback TOTP yükleyici (script onerror için)
window.loadFallbackTotp = function () {
    console.warn('[TOTP] Kütüphane yüklenemedi, Web Crypto yedek kullanılıyor.');
};

// DOM hazır olduğunda başlat
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
