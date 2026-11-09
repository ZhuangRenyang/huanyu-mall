/**
 * 客户端 IP 归一化（纯函数，无副作用）。
 *
 * 限流按 IP 计数，若不做归一化，IPv6 客户端可在一个 /64 前缀下轮换地址绕过限流；
 * 这里把 IPv6 归并到 /64 前缀，IPv4 原样小写。
 */

/** 归一化客户端 IP：IPv4 原样返回；IPv6 归并到 /64 前缀（形如 "2001:db8:85a3::/64"）。 */
export function normalizeClientIp(raw: string): string {
  const ip = raw.trim().toLowerCase();
  if (ip === "") return "unknown";
  if (!ip.includes(":")) return ip;

  const expanded = expandIpv6(ip);
  if (!expanded) return ip;
  // IPv4 映射地址（::ffff:a.b.c.d）按其 IPv4 形态计数，避免全部落到同一桶。
  if (isIpv4Mapped(expanded)) {
    return ipv4FromMapped(expanded);
  }
  return `${expanded.slice(0, 4).join(":")}::/64`;
}

function isIpv4Mapped(parts: string[]): boolean {
  return (
    parts[0] === "0000" &&
    parts[1] === "0000" &&
    parts[2] === "0000" &&
    parts[3] === "0000" &&
    parts[4] === "0000" &&
    parts[5] === "ffff"
  );
}

function ipv4FromMapped(parts: string[]): string {
  const high = Number.parseInt(parts[6] ?? "0", 16);
  const low = Number.parseInt(parts[7] ?? "0", 16);
  const a = (high >> 8) & 0xff;
  const b = high & 0xff;
  const c = (low >> 8) & 0xff;
  const d = low & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

/** 把 IPv6 文本展开为 8 段 16 进制；格式非法返回 null。 */
function expandIpv6(ip: string): string[] | null {
  const zoneIndex = ip.indexOf("%");
  const addr = zoneIndex >= 0 ? ip.slice(0, zoneIndex) : ip;

  let head = addr;
  const lastColon = addr.lastIndexOf(":");
  const lastPart = addr.slice(lastColon + 1);
  if (lastPart.includes(".")) {
    const octets = lastPart.split(".").map((s) => Number(s));
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return null;
    }
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    head = `${addr.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }

  const doubleColon = head.indexOf("::");
  if (doubleColon >= 0 && head.indexOf("::", doubleColon + 1) >= 0) return null;

  const left = doubleColon >= 0 ? head.slice(0, doubleColon) : head;
  const right = doubleColon >= 0 ? head.slice(doubleColon + 2) : "";
  const leftParts = left === "" ? [] : left.split(":");
  const rightParts = right === "" ? [] : right.split(":");
  const fill = 8 - leftParts.length - rightParts.length;
  if (fill < 0 || (doubleColon < 0 && fill !== 0)) return null;

  const parts = [...leftParts, ...new Array<string>(fill).fill("0"), ...rightParts];
  if (parts.length !== 8) return null;
  if (parts.some((p) => p !== "" && !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => p.padStart(4, "0"));
}
