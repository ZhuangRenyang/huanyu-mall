-- M06 0014：限时秒杀（ADR-099）。
--
-- 秒杀 = 「限时 + 限量」的特价：价格由 flash_price_minor 直接替换原价，
-- 库存是**营销限量**（活动最多卖多少），与仓库库存是两道独立的闸：
-- 活动库存管「活动放多少」，inventory 管「仓库有多少」，两个都要过。
--
-- sold 的扣减用条件 UPDATE（sold + n <= stock）实现，DB 再加 CHECK 兜底，
-- 并发下也不会超卖 —— 超卖就是资损。

CREATE TABLE IF NOT EXISTS flash_sale (
  id text PRIMARY KEY,
  name text NOT NULL,
  -- draft = 未开始（草稿）/ active = 进行中 / ended = 已结束
  status text NOT NULL DEFAULT 'draft',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_flash_sale_status CHECK (status IN ('draft', 'active', 'ended')),
  CONSTRAINT chk_flash_sale_window CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS flash_sale_item (
  id text PRIMARY KEY,
  flash_sale_id text NOT NULL,
  variant_id text NOT NULL,
  -- 商品/规格快照：商品改名或下架后，活动页与订单留痕仍可读
  title text NOT NULL,
  original_price_minor bigint NOT NULL,
  flash_price_minor bigint NOT NULL,
  stock integer NOT NULL,
  sold integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_flash_item_price CHECK (flash_price_minor > 0 AND flash_price_minor < original_price_minor),
  CONSTRAINT chk_flash_item_stock CHECK (stock > 0),
  CONSTRAINT chk_flash_item_sold CHECK (sold >= 0 AND sold <= stock)
);

-- 同一活动里同一个规格只能出现一次（两条价格打架，顾客不知道按哪个）
CREATE UNIQUE INDEX IF NOT EXISTS uq_flash_item_variant ON flash_sale_item (flash_sale_id, variant_id);
CREATE INDEX IF NOT EXISTS idx_flash_item_sale ON flash_sale_item (flash_sale_id);
CREATE INDEX IF NOT EXISTS idx_flash_sale_window ON flash_sale (status, starts_at, ends_at);

COMMENT ON TABLE flash_sale IS '限时秒杀活动（ADR-099）';
COMMENT ON TABLE flash_sale_item IS '秒杀活动商品（ADR-099）：活动库存独立于仓库库存，sold 条件更新防超卖';
