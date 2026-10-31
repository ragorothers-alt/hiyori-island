-- 版本識別改用前端每次修改都換一個的隨機字串（rev）：各台時鐘不準時，用時間當版本號可能撞號。
-- saved_at 留著，只拿來顯示「那一版是什麼時候改的」。NULL = 還沒有資料
ALTER TABLE vaults ADD COLUMN rev TEXT;
