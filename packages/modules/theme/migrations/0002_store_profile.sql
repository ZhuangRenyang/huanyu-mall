-- M17 0002：店铺资料（ADR-045）。
--
-- 发货单要印店名与客服电话、店头要显示店名、页脚要显示联系方式 —— 之前全是写死的。
-- 放在 theme_settings 而不是新开一张表：它本来就是单例的「店铺外观与身份」配置，
-- 再开一张单行表只会让「店铺信息」分散在两处。

ALTER TABLE theme_settings ADD COLUMN IF NOT EXISTS store_name text NOT NULL DEFAULT '全球商城';
ALTER TABLE theme_settings ADD COLUMN IF NOT EXISTS support_phone text;
