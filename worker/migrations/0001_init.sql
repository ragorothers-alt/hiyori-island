-- 線上同步：每組同步碼一個 vault，整份小島壓縮、加密後存成一列。
-- 伺服器拿不到同步碼：hash 是前端由同步碼推導出的 vault id 再取 SHA-256；data 是密文。
CREATE TABLE vaults (
  hash TEXT PRIMARY KEY,
  -- 目前這份的版本（前端存檔時的 updatedAt）；0 = 還沒有資料
  saved_at INTEGER NOT NULL DEFAULT 0,
  -- base64(格式 1 byte + IV 12 bytes + AES-GCM 密文)
  data TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
