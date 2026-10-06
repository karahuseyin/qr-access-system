-- ============================================================
-- QR Kod Tabanlı Geçiş Kontrol Sistemi - SQL Server DDL
-- ============================================================

USE master;
GO

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'QRAccessControl')
BEGIN
    CREATE DATABASE QRAccessControl
    COLLATE Turkish_CI_AS;
END
GO

USE QRAccessControl;
GO

-- ============================================================
-- 1. USERS (Kullanıcılar)
-- ============================================================
IF OBJECT_ID('dbo.Users', 'U') IS NOT NULL
    DROP TABLE dbo.Users;
GO

CREATE TABLE dbo.Users (
    Id          INT             NOT NULL IDENTITY(1,1),
    Name        NVARCHAR(150)   NOT NULL,
    Email       NVARCHAR(255)   NOT NULL,
    SecretSeed  NVARCHAR(64)    NOT NULL,   -- TOTP için Base32 encoded secret
    IsActive    BIT             NOT NULL DEFAULT 1,
    CreatedAt   DATETIME2(0)    NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt   DATETIME2(0)    NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_Users PRIMARY KEY CLUSTERED (Id ASC),
    CONSTRAINT UQ_Users_Email UNIQUE (Email)
);
GO

-- Email aramaları için index
CREATE NONCLUSTERED INDEX IX_Users_Email
    ON dbo.Users (Email ASC)
    WHERE IsActive = 1;
GO

-- ============================================================
-- 2. DEVICES (Kapılar / Okuyucular)
-- ============================================================
IF OBJECT_ID('dbo.Devices', 'U') IS NOT NULL
    DROP TABLE dbo.Devices;
GO

CREATE TABLE dbo.Devices (
    Id              INT             NOT NULL IDENTITY(1,1),
    DeviceCode      NVARCHAR(50)    NOT NULL,   -- Örn: ESP32-KAPI-01
    LocationName    NVARCHAR(200)   NOT NULL,
    IpAddress       NVARCHAR(45)    NULL,        -- IPv6 uyumlu (max 45 karakter)
    IsActive        BIT             NOT NULL DEFAULT 1,
    CreatedAt       DATETIME2(0)    NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt       DATETIME2(0)    NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_Devices PRIMARY KEY CLUSTERED (Id ASC),
    CONSTRAINT UQ_Devices_DeviceCode UNIQUE (DeviceCode)
);
GO

CREATE NONCLUSTERED INDEX IX_Devices_DeviceCode
    ON dbo.Devices (DeviceCode ASC)
    WHERE IsActive = 1;
GO

-- ============================================================
-- 3. ACCESS RULES (Yetkilendirmeler) - N:M İlişki
-- ============================================================
IF OBJECT_ID('dbo.AccessRules', 'U') IS NOT NULL
    DROP TABLE dbo.AccessRules;
GO

CREATE TABLE dbo.AccessRules (
    Id          INT             NOT NULL IDENTITY(1,1),
    UserId      INT             NOT NULL,
    DeviceId    INT             NOT NULL,
    ValidFrom   DATETIME2(0)    NOT NULL DEFAULT SYSUTCDATETIME(),
    ValidTo     DATETIME2(0)    NULL,       -- NULL = süresiz yetki
    CreatedAt   DATETIME2(0)    NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_AccessRules PRIMARY KEY CLUSTERED (Id ASC),

    CONSTRAINT FK_AccessRules_Users
        FOREIGN KEY (UserId) REFERENCES dbo.Users(Id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT FK_AccessRules_Devices
        FOREIGN KEY (DeviceId) REFERENCES dbo.Devices(Id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    -- Aynı kullanıcı + cihaz çifti sadece bir kez aktif kural taşıyabilir
    CONSTRAINT UQ_AccessRules_UserDevice UNIQUE (UserId, DeviceId)
);
GO

-- Yetki doğrulama sorgusu için bileşik index
CREATE NONCLUSTERED INDEX IX_AccessRules_UserId_DeviceId_ValidTo
    ON dbo.AccessRules (UserId ASC, DeviceId ASC, ValidTo ASC)
    INCLUDE (ValidFrom);
GO

-- ============================================================
-- 4. ACCESS LOGS (Geçiş Logları)
-- ============================================================
IF OBJECT_ID('dbo.AccessLogs', 'U') IS NOT NULL
    DROP TABLE dbo.AccessLogs;
GO

CREATE TABLE dbo.AccessLogs (
    Id          BIGINT          NOT NULL IDENTITY(1,1),
    UserId      INT             NULL,        -- NULL: bilinmeyen kullanıcı (geçersiz QR)
    DeviceId    INT             NULL,        -- NULL: tanımsız cihaz
    QrPayload   NVARCHAR(512)   NOT NULL,    -- Gelen ham QR metni (audit için)
    AccessTime  DATETIME2(3)    NOT NULL DEFAULT SYSUTCDATETIME(),
    IsGranted   BIT             NOT NULL DEFAULT 0,
    FailReason  NVARCHAR(500)   NULL,        -- Ret nedeni (INVALID_TOTP, NO_PERMISSION, vb.)

    CONSTRAINT PK_AccessLogs PRIMARY KEY CLUSTERED (Id ASC),

    CONSTRAINT FK_AccessLogs_Users
        FOREIGN KEY (UserId) REFERENCES dbo.Users(Id)
        ON DELETE SET NULL ON UPDATE CASCADE,

    CONSTRAINT FK_AccessLogs_Devices
        FOREIGN KEY (DeviceId) REFERENCES dbo.Devices(Id)
        ON DELETE SET NULL ON UPDATE CASCADE
);
GO

-- Tarih bazlı sorgular için temel index (raporlama, audit)
CREATE NONCLUSTERED INDEX IX_AccessLogs_AccessTime
    ON dbo.AccessLogs (AccessTime DESC);
GO

-- Kullanıcı geçiş geçmişi için index
CREATE NONCLUSTERED INDEX IX_AccessLogs_UserId_AccessTime
    ON dbo.AccessLogs (UserId ASC, AccessTime DESC)
    WHERE UserId IS NOT NULL;
GO

-- Cihaz bazlı log sorgular için index
CREATE NONCLUSTERED INDEX IX_AccessLogs_DeviceId_AccessTime
    ON dbo.AccessLogs (DeviceId ASC, AccessTime DESC)
    WHERE DeviceId IS NOT NULL;
GO

-- ============================================================
-- ÖRNEK VERİLER (Test için)
-- ============================================================

-- Test kullanıcısı (SecretSeed gerçek ortamda /api/auth/register-device ile üretilir)
INSERT INTO dbo.Users (Name, Email, SecretSeed, IsActive)
VALUES (N'Test Kullanıcı', 'test@example.com', 'JBSWY3DPEHPK3PXP', 1);
GO

-- Test cihazı
INSERT INTO dbo.Devices (DeviceCode, LocationName, IpAddress, IsActive)
VALUES ('ESP32-KAPI-01', N'Ana Giriş Kapısı', '192.168.1.101', 1);
GO

-- Yetkilendirme: User 1 -> Device 1 (süresiz)
INSERT INTO dbo.AccessRules (UserId, DeviceId, ValidFrom, ValidTo)
VALUES (1, 1, SYSUTCDATETIME(), NULL);
GO

PRINT 'QRAccessControl veritabani basariyla olusturuldu.';
GO
