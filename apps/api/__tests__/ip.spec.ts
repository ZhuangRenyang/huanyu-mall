import { describe, expect, it } from "vitest";
import { normalizeClientIp } from "../src/utils/ip.js";

describe("客户端 IP 归一化（限流键）", () => {
  it("1. IPv4 原样返回（小写）", () => {
    expect(normalizeClientIp("203.0.113.10")).toBe("203.0.113.10");
    expect(normalizeClientIp(" 203.0.113.10 ")).toBe("203.0.113.10");
  });

  it("2. IPv6 归并到 /64 前缀（防地址轮换绕过限流）", () => {
    const a = normalizeClientIp("2001:db8:85a3:1234:5678:8a2e:370:7334");
    const b = normalizeClientIp("2001:db8:85a3:1234:9999:1111:2222:3333");
    expect(a).toBe(b);
    // /64 = 前 4 个 hextet，后 4 段不参与计数
    expect(a).toBe("2001:0db8:85a3:1234::/64");
    const other = normalizeClientIp("2001:db8:85a3:ffff:5678:8a2e:370:7334");
    expect(other).not.toBe(a);
  });

  it("3. IPv4 映射地址按 IPv4 形态计数（不与其它映射地址混桶）", () => {
    expect(normalizeClientIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeClientIp("::ffff:203.0.113.5")).toBe("203.0.113.5");
  });

  it("4. 非法输入不抛异常，退回原值", () => {
    expect(normalizeClientIp("")).toBe("unknown");
    expect(normalizeClientIp("not-an-ip")).toBe("not-an-ip");
    expect(() => normalizeClientIp("2001:db8:::1")).not.toThrow();
  });
});
