/**
 * ============================================================
 *  QR Kod Tabanlı Geçiş Kontrol Sistemi
 *  Modül 1: ESP32 Edge Kontrolcü Yazılımı
 * ============================================================
 *  Platform : ESP32 (Arduino / PlatformIO)
 *  Kütüphaneler:
 *    - WiFi.h          (built-in)
 *    - HTTPClient.h    (built-in)
 *    - ArduinoJson     (v6+ - Library Manager)
 *    - Wiegand         (monkeyboard/Wiegand - Library Manager)
 * ============================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wiegand.h>

// ──────────────────────────────────────────────
//  KONFİGÜRASYON - Ortamınıza göre değiştirin
// ──────────────────────────────────────────────
namespace Config {
    // Wi-Fi
    constexpr char WIFI_SSID[]     = "WIFI_ADI";
    constexpr char WIFI_PASSWORD[] = "WIFI_SIFRE";

    // Backend API
    constexpr char API_HOST[]      = "http://192.168.1.100:3000"; // Sunucu IP
    constexpr char VERIFY_ENDPOINT[] = "/api/access/verify";

    // Cihaz Kimliği (veritabanındaki DeviceCode ile eşleşmeli)
    constexpr char DEVICE_ID[] = "ESP32-KAPI-01";

    // Pin tanımları
    constexpr uint8_t WIEGAND_D0  = 4;
    constexpr uint8_t WIEGAND_D1  = 5;
    constexpr uint8_t RELAY_PIN   = 18;  // Active HIGH

    // Süreler (ms)
    constexpr uint32_t RELAY_OPEN_DURATION_MS = 3000;   // 3 saniye
    constexpr uint32_t WIFI_RECONNECT_MS      = 5000;   // 5 saniyede bir yeniden bağlanma dene
    constexpr uint32_t HTTP_TIMEOUT_MS        = 8000;   // HTTP zaman aşımı
    constexpr uint32_t QR_COOLDOWN_MS         = 2000;   // Ardışık okuma engeli (ms)
}

// ──────────────────────────────────────────────
//  DURUM DEĞİŞKENLERİ
// ──────────────────────────────────────────────
WIEGAND wg;

// Röle non-blocking kontrolü
bool       relayActive        = false;
uint32_t   relayActivatedAt   = 0;

// Wi-Fi yeniden bağlanma kontrolü
uint32_t   lastWifiCheck      = 0;

// Wiegand'dan okunan veri (ISR → loop arası iletişim)
volatile bool    dataReceived  = false;
volatile uint8_t receivedBits  = 0;
volatile uint64_t receivedCode = 0;

// Tekrar okuma önleme
uint32_t   lastQrReadAt = 0;

// ──────────────────────────────────────────────
//  WIEGAND KESMELERİ (ISR)
// ──────────────────────────────────────────────
void IRAM_ATTR onD0() { wg.ReadD0(); }
void IRAM_ATTR onD1() { wg.ReadD1(); }

// ──────────────────────────────────────────────
//  YARDIMCI FONKSİYONLAR
// ──────────────────────────────────────────────

/**
 * Wiegand ham sayısal değerini ASCII string'e dönüştürür.
 * QR okuyucular genellikle ASCII karakter kodlarını Wiegand üzerinden
 * arka arkaya 8-bit frame'ler halinde iletir.
 * Bu fonksiyon receivedCode değerini ondalık string olarak döndürür;
 * okuyucunuzun encoding'ine göre dönüşüm mantığını güncelleyin.
 */
String decodeWiegandToString(uint64_t code, uint8_t bits) {
    // Wiegand 34-bit: iki parite biti + 32-bit veri
    // Wiegand 64-bit: doğrudan veri alanı
    // QR payload ASCII encoding: her 8 bit bir karakter
    String result = "";

    if (bits <= 32) {
        // 32 bitlik veriden ASCII karakterleri çöz
        // Bazı okuyucular veriyi decimal sayı olarak gönderir
        result = String((uint32_t)code);
    } else {
        // 64 bit: 8 karakter ASCII decode
        for (int i = 7; i >= 0; i--) {
            char c = (char)((code >> (i * 8)) & 0xFF);
            if (c >= 0x20 && c <= 0x7E) { // Yazdırılabilir ASCII
                result += c;
            }
        }
    }

    // Boşsa decimal string olarak döndür
    if (result.isEmpty()) {
        result = String((unsigned long long)code);
    }

    return result;
}

/**
 * Wi-Fi bağlantı durumunu kontrol eder; bağlı değilse yeniden bağlanır.
 * Bloklayıcı değil — mevcut döngüde sadece başlatır.
 */
void maintainWifiConnection() {
    if (WiFi.status() == WL_CONNECTED) return;

    uint32_t now = millis();
    if (now - lastWifiCheck < Config::WIFI_RECONNECT_MS) return;
    lastWifiCheck = now;

    Serial.println("[WiFi] Bağlantı kesildi, yeniden bağlanılıyor...");
    WiFi.disconnect(true);
    WiFi.begin(Config::WIFI_SSID, Config::WIFI_PASSWORD);
}

/**
 * Backend API'ye POST isteği gönderir.
 * @param qrPayload  QR koddan okunan ham metin
 * @return HTTP durum kodu (başarılıysa 200, hata durumunda negatif veya 403)
 */
int sendVerifyRequest(const String& qrPayload) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[HTTP] Wi-Fi bağlı değil, istek iptal edildi.");
        return -1;
    }

    HTTPClient http;
    String url = String(Config::API_HOST) + String(Config::VERIFY_ENDPOINT);

    Serial.print("[HTTP] POST → ");
    Serial.println(url);

    http.begin(url);
    http.setTimeout(Config::HTTP_TIMEOUT_MS);
    http.addHeader("Content-Type", "application/json");

    // JSON payload oluştur
    StaticJsonDocument<256> doc;
    doc["deviceId"]   = Config::DEVICE_ID;
    doc["qrPayload"]  = qrPayload;

    String body;
    serializeJson(doc, body);
    Serial.print("[HTTP] Body: ");
    Serial.println(body);

    int httpCode = http.POST(body);

    if (httpCode > 0) {
        Serial.print("[HTTP] Yanıt kodu: ");
        Serial.println(httpCode);
        String response = http.getString();
        Serial.print("[HTTP] Yanıt: ");
        Serial.println(response);
    } else {
        Serial.print("[HTTP] İstek hatası: ");
        Serial.println(http.errorToString(httpCode));
    }

    http.end();
    return httpCode;
}

/**
 * Röleyi non-blocking olarak aktif eder.
 */
void activateRelay() {
    digitalWrite(Config::RELAY_PIN, HIGH);
    relayActive      = true;
    relayActivatedAt = millis();
    Serial.println("[RÖLE] Kapı açıldı (3 sn).");
}

/**
 * Röle süre dolduğunda pasif eder. loop() içinde çağrılır.
 */
void handleRelayTimeout() {
    if (!relayActive) return;
    if (millis() - relayActivatedAt >= Config::RELAY_OPEN_DURATION_MS) {
        digitalWrite(Config::RELAY_PIN, LOW);
        relayActive = false;
        Serial.println("[RÖLE] Kapı kapandı.");
    }
}

/**
 * QR payload'ını işler: API'ye gönderir ve sonuca göre röleyi kontrol eder.
 */
void processQrPayload(const String& payload) {
    Serial.print("[QR] Okunan veri: ");
    Serial.println(payload);

    if (payload.isEmpty()) {
        Serial.println("[QR] Boş payload, işlem iptal edildi.");
        return;
    }

    // Tekrar okuma koruması
    uint32_t now = millis();
    if (now - lastQrReadAt < Config::QR_COOLDOWN_MS) {
        Serial.println("[QR] Çok sık okuma, bekleniyor...");
        return;
    }
    lastQrReadAt = now;

    int statusCode = sendVerifyRequest(payload);

    if (statusCode == 200) {
        Serial.println("[DURUM] Geçiş ONAYLANDI ✓");
        activateRelay();
    } else if (statusCode == 403) {
        Serial.println("[DURUM] Geçiş REDDEDİLDİ ✗ (Yetkisiz)");
        // Opsiyonel: Buzzer pini varsa burada tetikle
        // digitalWrite(BUZZER_PIN, HIGH); delay(100); digitalWrite(BUZZER_PIN, LOW);
    } else {
        Serial.print("[DURUM] Geçiş REDDEDİLDİ ✗ (Hata kodu: ");
        Serial.print(statusCode);
        Serial.println(")");
    }
}

// ──────────────────────────────────────────────
//  SETUP
// ──────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== QR Geçiş Kontrol Sistemi Başlatılıyor ===");

    // Pin yapılandırması
    pinMode(Config::RELAY_PIN, OUTPUT);
    digitalWrite(Config::RELAY_PIN, LOW); // Röle başlangıçta kapalı

    // Wiegand kütüphanesi başlatma
    wg.begin(Config::WIEGAND_D0, Config::WIEGAND_D1, true); // true = active low
    attachInterrupt(digitalPinToInterrupt(Config::WIEGAND_D0), onD0, FALLING);
    attachInterrupt(digitalPinToInterrupt(Config::WIEGAND_D1), onD1, FALLING);
    Serial.println("[WIEGAND] Kesme dinleyiciler başlatıldı.");

    // Wi-Fi bağlantısı
    Serial.print("[WiFi] Bağlanılıyor: ");
    Serial.println(Config::WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(Config::WIFI_SSID, Config::WIFI_PASSWORD);

    uint8_t attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println();
        Serial.print("[WiFi] Bağlandı! IP: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\n[WiFi] UYARI: Bağlantı kurulamadı, offline modda devam ediliyor.");
    }

    Serial.println("=== Sistem Hazır, QR bekleniyor... ===\n");
}

// ──────────────────────────────────────────────
//  LOOP (Bloklayıcı olmayan ana döngü)
// ──────────────────────────────────────────────
void loop() {
    // 1. Wi-Fi bağlantı sağlığını kontrol et
    maintainWifiConnection();

    // 2. Wiegand verisini kontrol et
    if (wg.available()) {
        uint8_t bits  = wg.getWiegandType();
        uint64_t code = wg.getCode();

        String payload = decodeWiegandToString(code, bits);
        processQrPayload(payload);
    }

    // 3. Röle zaman aşımını kontrol et
    handleRelayTimeout();

    // 4. Kısa yield (watchdog besleme)
    yield();
}
