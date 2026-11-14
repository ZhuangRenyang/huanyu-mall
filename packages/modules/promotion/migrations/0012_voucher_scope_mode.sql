-- M06 0012：券的「排除范围」（ADR-092）。
--
-- 原来 specific_product 只有「白名单」：指定哪些商品/分类可用。
-- 商家要「除清仓外全场通用」只能把每个商品都点一遍，做不到。
-- scope_mode 区分：include = 指定可用（老行为）；exclude = 指定不可用（黑名单）。

ALTER TABLE voucher ADD COLUMN IF NOT EXISTS scope_mode text NOT NULL DEFAULT 'include';

COMMENT ON COLUMN voucher.scope_mode IS '适用范围模式（ADR-092）：include = 指定可用；exclude = 指定不可用。仅 specific_product 生效';
