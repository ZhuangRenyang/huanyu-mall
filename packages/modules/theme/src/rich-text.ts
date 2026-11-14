import sanitizeHtml from "sanitize-html";

/**
 * 微页面富文本清洗（ADR-091）。
 *
 * 富文本 HTML 在**服务端**过白名单后才入库，前端渲染时 `dangerouslySetInnerHTML`
 * 是安全的——内容里不可能有 script / 事件属性 / javascript: 链接。
 *
 * 白名单对齐 wangEditor/CRMEB 的常用排版能力，砍掉一切能执行脚本的东西：
 *   - 允许：段落/标题/列表/表格/引用/代码/图片/链接/加粗斜体等排版标签；
 *   - 链接强制 rel nofollow + target _blank，href 只放行 http/https/mailto/tel；
 *   - img src 只放行 http/https/data:image（外链图或粘贴的 base64 图）；
 *   - style 只保留 text-align（对齐），其余一律剥掉。
 */
const ALLOWED_TAGS = sanitizeHtml.defaults.allowedTags.concat([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "pre",
  "code",
  "u",
  "s",
  "strike",
  "sub",
  "sup",
  "span",
  "figure",
  "figcaption",
  // 2.18 起默认白名单已不含 img，图片必须显式放行
  "img",
]);

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      // 对齐：只有这个 style 有意义，其它（position/display/expression）都是风险
      "*": ["style"],
    },
    allowedStyles: {
      "*": {
        "text-align": [/^left$/, /^right$/, /^center$/, /^justify$/],
        "text-indent": [/^\d+(\.\d+)?(px|em|rem)$/],
      },
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      }),
    },
  });
}

/**
 * 判断一段正文是否需要走富文本渲染。
 * 老数据 content_format 缺省是 plain；新富文本显式写 html。
 */
export type MicroPageContentFormat = "plain" | "html";

export function normalizeContentFormat(format: string | null | undefined): MicroPageContentFormat {
  return format === "html" ? "html" : "plain";
}
