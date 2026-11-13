-- M17 0003：店铺公告（ADR-047）。
--
-- 后台外观设置页的「首页通告条」输入框从一期就在，但既没有数据库列、
-- 也没有店面渲染：商家写完点保存，内容直接消失。这里补上落点。

ALTER TABLE theme_settings ADD COLUMN IF NOT EXISTS announcement text;
