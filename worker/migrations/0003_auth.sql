-- 寫入要驗證：前端由同步碼另外推導一把 auth（跟 vault id 互相推不出來），伺服器只存它的 SHA-256。
-- 只知道 vault id（例如出現在紀錄、截圖裡）的人可以讀到密文，但不能寫入、回滾或刪除。
-- 舊的 vault 是 NULL：第一次帶著 auth 的寫入就記下來，之後的寫入和刪除都要對得上
ALTER TABLE vaults ADD COLUMN auth TEXT;
-- 算「最近一天建立了幾個」用
CREATE INDEX vaults_created ON vaults (created_at);

-- 濫用防護的計數器：AI 一天用了幾次、通行碼錯了幾次。過了 reset_at 就從頭算
CREATE TABLE counters (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);
