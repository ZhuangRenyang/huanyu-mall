import { describe, expect, it } from "vitest";
import { normalizeContentFormat, sanitizeRichText } from "@mall/theme";

/**
 * 微页面富文本清洗（ADR-091）。
 *
 * 富文本 HTML 在服务端过白名单才入库，前端才敢 dangerouslySetInnerHTML。
 * 这里守住「能执行脚本的东西必须被剥掉」这条安全线。
 */
describe("富文本清洗（ADR-091）", () => {
  it("保留排版标签，剥掉 script / 事件属性", () => {
    const html =
      '<h2>标题</h2><p onclick="alert(1)">正文<strong>加粗</strong></p><script>alert(1)</script>';
    const out = sanitizeRichText(html);
    expect(out).toContain("<h2>标题</h2>");
    expect(out).toContain("<strong>加粗</strong>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("alert(1)");
  });

  it("链接：javascript: 被剥掉，http/https 保留并强制 rel/target", () => {
    const evil = sanitizeRichText('<a href="javascript:alert(1)">点我</a>');
    expect(evil).not.toContain("javascript:");
    const good = sanitizeRichText('<a href="https://example.com">官网</a>');
    expect(good).toContain('href="https://example.com"');
    expect(good).toContain('rel="noopener noreferrer nofollow"');
    expect(good).toContain('target="_blank"');
  });

  it("图片只放行 http/https/data，onerror 被剥掉", () => {
    const out = sanitizeRichText(
      '<img src="https://a.com/1.png" onerror="alert(1)" alt="图">',
    );
    expect(out).toContain('src="https://a.com/1.png"');
    expect(out).not.toContain("onerror");
  });

  it("style 只保留 text-align，position/expression 被剥掉", () => {
    const out = sanitizeRichText(
      '<p style="text-align:center;position:absolute;background:url(javascript:1)">x</p>',
    );
    expect(out).toContain("text-align:center");
    expect(out).not.toContain("position:absolute");
  });

  it("format 归一化：html 之外一律 plain（老数据缺省 plain）", () => {
    expect(normalizeContentFormat("html")).toBe("html");
    expect(normalizeContentFormat("plain")).toBe("plain");
    expect(normalizeContentFormat(null)).toBe("plain");
    expect(normalizeContentFormat("HTML")).toBe("plain");
  });
});
