-- M17 0011：微页面富文本（ADR-091）。
--
-- content 一直是纯文本（按空行分段）。富文本需要存 HTML，
-- 但老数据不能突然被当 HTML 渲染（纯文本里的 < > 会被吃掉/误解）。
-- 加 content_format 标记：plain = 老行为，html = 已清洗的富文本。

ALTER TABLE theme_micro_page
  ADD COLUMN IF NOT EXISTS content_format text NOT NULL DEFAULT 'plain';

COMMENT ON COLUMN theme_micro_page.content_format IS '正文格式：plain = 纯文本空行分段；html = 服务端已清洗的富文本（ADR-091）';
