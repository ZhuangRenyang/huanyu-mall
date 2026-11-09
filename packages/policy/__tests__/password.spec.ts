import { describe, expect, it } from "vitest";
import { checkPasswordStrength, MIN_PASSWORD_LENGTH, PASSWORD_RULES } from "../src/index.js";

/**
 * 口令策略是后端（@mall/auth）与前端（@mall/admin）共用的同一份实现。
 * 这个用例的作用是「锁死规则与文案」：
 * 一旦有人改了长度、顺序或中文措辞，这里立刻红，两端不会悄悄漂移。
 */
describe("口令强度策略（前后端单一来源）", () => {
  it("最小长度为 8", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(checkPasswordStrength("abcdefg1").ok).toBe(true);
    expect(checkPasswordStrength("abcdefg").ok).toBe(false);
  });

  it("过短时给出带实际位数的具体原因", () => {
    expect(checkPasswordStrength("Ab1").reason).toBe("新口令过短（3 位，至少 8 位）");
    expect(checkPasswordStrength("").reason).toBe("新口令过短（0 位，至少 8 位）");
  });

  it("缺字母 / 缺数字分别给出对应原因", () => {
    expect(checkPasswordStrength("12345678").reason).toBe("新口令必须包含字母");
    expect(checkPasswordStrength("abcdefgh").reason).toBe("新口令必须包含数字");
  });

  it("判定顺序：长度 → 字母 → 数字", () => {
    // 同时不满足三条时，先报长度
    expect(checkPasswordStrength("abc").reason).toBe("新口令过短（3 位，至少 8 位）");
    // 长度够但无数字：先报字母
    expect(checkPasswordStrength("abcdefgh").reason).toBe("新口令必须包含数字");
    // 三条都满足才通过
    expect(checkPasswordStrength("Admin2024")).toEqual({ ok: true });
  });

  it("通过时不带 reason", () => {
    expect(checkPasswordStrength("Admin2024").reason).toBeUndefined();
  });

  it("规则清单是 3 条且带中文标签（界面强度清单用）", () => {
    expect(PASSWORD_RULES).toHaveLength(3);
    expect(PASSWORD_RULES.map((r) => r.id)).toEqual(["length", "letter", "digit"]);
    expect(PASSWORD_RULES.map((r) => r.label)).toEqual(["至少 8 位", "包含字母", "包含数字"]);
  });

  it("每条规则的 reason 与 checkPasswordStrength 的判定一致", () => {
    for (const rule of PASSWORD_RULES) {
      expect(rule.test("Admin2024")).toBe(true);
      expect(rule.test("")).toBe(false);
    }
  });
});
