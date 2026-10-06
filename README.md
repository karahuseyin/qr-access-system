# QR Kod Tabanlı Geçiş Kontrol Sistemi

Tam yığın (Full-Stack) geçiş kontrol sistemi: ESP32 donanımı, Node.js/Express backend, Vanilla JS PWA ve SQL Server veritabanından oluşur.

## Klasör Yapısı

```
qr-access-system/
├── database/
│   └── schema.sql              ← SQL Server DDL (tablolar + indexler)
│
├── esp32/
│   └── main.ino                ← ESP32 Arduino kodu
│
├── backend/
│   ├── package.json
│   ├── .env.example            ← .env olarak kopyalayın
│   └── src/
│       ├── app.js              ← Express giriş noktası
│       ├── config/
│       │   └── database.js     ← SQL Server bağlantı havuzu
│       ├── routes/
│       │   ├── authRoutes.js
│       │   └── accessRoutes.js
│       ├── controllers/
│       │   ├── authController.js
│       │   └── accessController.js
│       ├── services/
│       │   └── totpService.js
│       └── models/
│           ├── User.js
│           ├── Device.js
│           └── AccessLog.js
│
├── frontend/
│   ├── package.json            ← PWA statik sunucu (HTTP + HTTPS)
│   ├── server.js               ← npm start ile çalışır
│   ├── tools/
│   │   └── make-icons.js       ← PWA ikonlarını yeniden üretir
│   └── public/
│       ├── index.html          ← Tek dosyalık PWA (offline çalışır)
│       ├── manifest.json
│       ├── service-worker.js   ← Offline önbellek
│       ├── icons/              ← PWA ikonları (192/512/180)
│       └── lib/
│           └── otpauth.umd.min.js  ← TOTP kütüphanesi (saf JS, HTTP'de de çalışır)
```

---

## Kurulum

### 1. Veritabanı

SQL Server Management Studio veya `sqlcmd` ile çalıştırın:

```sql
sqlcmd -S localhost -U sa -P "Sifreniz" -i database/schema.sql
```

---

### 2. Backend

```bash
cd backend
cp .env.example .env
# .env dosyasını düzenleyin (DB bağlantısı, port vb.)
npm install
npm start          # Üretim
npm run dev        # Geliştirme (nodemon)
```

**API Endpoints:**

| Yöntem | URL | Açıklama |
|--------|-----|----------|
| POST | `/api/auth/register-device` | Kullanıcı + seed kaydı |
| POST | `/api/access/verify` | ESP32'den QR doğrulama |
| GET  | `/health` | Sağlık kontrolü |

---

### 3. Frontend (PWA — offline QR)

`frontend/` klasöründe hazır bir sunucu gelir. PWA kurulumu (ve offline çalışma)
**HTTPS** gerektirdiğinden, ilk çalıştırmada kendi kendine imzalı sertifika
otomatik üretilir:

```bash
cd frontend
npm install
npm start        # HTTP :8080 + HTTPS :8443 birlikte açılır
```

Sunucu açıldığında konsolda telefondan kullanılacak adresi gösterir
(örn. `https://192.168.1.50:8443`).

**Telefonda tek seferlik kurulum (internet gerekir):**
1. Chrome ile `https://<sunucu-ip>:8443` adresini açın
2. Sertifika uyarısında **Gelişmiş → Risksini kabul ederek devam et**
3. Ad Soyad, e-posta ve sunucu adresini girip **Cihazı Kaydet**'e basın
4. Sağ alttaki **⬇ Uygulamayı Yükle** butonuna basın (veya menü → "Uygulamayı yükle")
5. Ana ekrana kısayol eklenir → artık **Wi-Fi/internet olmadan** açılır

**Offline kullanım:** Kayıt sonrası her şey telefonda saklanır
(`localStorage`) ve TOTP kodu telefonda üretilir (otpauth — saf JS,
HTTP'de bile çalışır). Doğrulama, kapıdaki ESP32'nin kendi Wi-Fi'ı üzerinden
yapılır; **telefonun ağa bağlı olması gerekmez**.

**iOS notu:** Safari'de Paylaş → "Ana Ekrana Ekle" ile kurulur. iOS, 7 gün
kullanılmayan sitelerin localStorage'ını silebilir; günlük kullanımda sorun
yoktur, uzun süre kullanılmayacaksa tekrar kayıt gerekebilir.

**Sertifika:** `frontend/certs/` silinirse bir sonraki açılışta yeni sertifika
üretilir (LAN IP'leri SAN olarak eklenir). Port değiştirmek için:
`HTTP_PORT=8080 HTTPS_PORT=8443 npm start`.

> Yalnızca masaüstü testi için `http://localhost:8080` de kullanılabilir;
> localhost güvenli bağlam sayılır, PWA kurulumu orada da çalışır.

---

### 4. ESP32

**Gerekli Kütüphaneler (Arduino Library Manager):**
- `ArduinoJson` (Benoit Blanchon)
- `Wiegand` (monkeyboard/Wiegand)

**`main.ino` içindeki yapılandırma:**
```cpp
constexpr char WIFI_SSID[]  = "WIFI_ADINIZ";
constexpr char WIFI_PASSWORD[] = "WIFI_SIFRENIZ";
constexpr char API_HOST[]   = "http://192.168.1.100:3000";
constexpr char DEVICE_ID[]  = "ESP32-KAPI-01";
```

`DEVICE_ID` veritabanındaki `Devices.DeviceCode` ile birebir eşleşmelidir.

**Pin Bağlantıları:**
| Pin | GPIO | Açıklama |
|-----|------|----------|
| D0  | 4    | Wiegand Data 0 |
| D1  | 5    | Wiegand Data 1 |
| RÖLE| 18   | Aktif HIGH, 3 sn |

---

## Sistem Akışı

```
PWA (Kayıt)  ──POST /api/auth/register-device──►  Backend
                                                      │
                                                 SecretSeed üret
                                                 DB'ye kaydet
                                                      │
             ◄──{ userId, secretSeed }────────────────┘
             localStorage'a kaydet

─────────────────────────────────────────────────────────────

PWA (Kullanım — OFFLINE):
  secretSeed + şimdiki_zaman → TOTP kodu (6 hane)
  QR payload = "userId:totpCode"
  Ekranda QR göster (30 sn'de bir yenile)

─────────────────────────────────────────────────────────────

ESP32 ──Wiegand── QR okuyucu
  QR verisi al → POST /api/access/verify
  { deviceId: "ESP32-KAPI-01", qrPayload: "123:847291" }

Backend doğrulama sırası:
  1. deviceId → Devices tablosu (var mı, aktif mi?)
  2. qrPayload ayrıştır (userId:totpCode)
  3. Users tablosu → SecretSeed al
  4. TOTP doğrula (±30 sn tolerans)
  5. AccessRules → kullanıcı bu kapıya yetkili mi?
  6. AccessLogs → kayıt yaz
  7. HTTP 200 veya 403 dön

ESP32:
  200 → Röle 3 sn HIGH (kapı açılır)
  403 → Röle kapalı (opsiyonel: buzzer)
```

---

## Güvenlik Notları

- `secretSeed` değerini HTTPS üzerinden iletin (PWA sunucusu bunun için `https://...:8443` sunar; kendi kendine imzalı sertifika LAN içi kullanım içindir)
- `localStorage` şifresiz kullanır — cihaz şifreleme önerilir
- TOTP ±30 sn tolerans: sunucu/istemci saat farkı 30 sn'yi geçmemeli
- Rate limiting varsayılan: dakikada 100 istek (`.env` ile ayarlanabilir)
- `qrPayload` veritabanında log olarak tutulur (audit trail)
