import { describe, expect, it } from "vitest";
import {
  RedisRateLimitStore,
  defineRateLimitCommand,
  makeRedisStoreCtor,
} from "../src/plugins/rate-limit-store.js";
import { silentLogger } from "./helpers/fake-deps.js";

/** 假 ioredis 客户端：记录命令调用并回放脚本返回值，不连真 Redis。 */
class FakeRedis {
  readonly commands: Array<{ name: string; args: unknown[] }> = [];
  readonly defined = new Set<string>();
  reply: [number, number] = [1, 60_000];
  failWith: Error | null = null;
  readonly warnings: unknown[] = [];

  defineCommand(name: string, opts: { numberOfKeys: number; lua: string }): void {
    this.defined.add(name);
    const impl = (...args: unknown[]) => {
      this.commands.push({ name, args });
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        if (this.failWith) cb(this.failWith);
        else cb(null, this.reply);
      }
    };
    (this as unknown as Record<string, unknown>)[name] = impl;
  }
}

function makeStore(redis: FakeRedis) {
  const logger = {
    ...silentLogger,
    warn: (obj: unknown) => {
      redis.warnings.push(obj);
    },
  };
  return new RedisRateLimitStore({
    redis: redis as never,
    prefix: "mall:rl:",
    logger,
  });
}

describe("限流 Redis 存储（Phase 4）", () => {
  it("1. 键带上环境前缀与档位，命令参数为窗口毫秒数", async () => {
    const redis = new FakeRedis();
    defineRateLimitCommand(redis as never);
    const store = makeStore(redis);

    const result = await new Promise<{ current: number; ttl: number }>((resolve, reject) => {
      store.incr("auth:1.2.3.4", (err, res) => (err ? reject(err) : resolve(res!)), 60_000, 5);
    });

    expect(redis.commands).toHaveLength(1);
    expect(redis.commands[0]!.name).toBe("mallRateLimit");
    expect(redis.commands[0]!.args[0]).toBe("mall:rl:auth:1.2.3.4");
    expect(redis.commands[0]!.args[1]).toBe(60_000);
    expect(result).toEqual({ current: 1, ttl: 60_000 });
  });

  it("2. Redis 报错时回调错误（配合 skipOnError 放行），并记 warn 日志", async () => {
    const redis = new FakeRedis();
    defineRateLimitCommand(redis as never);
    redis.failWith = new Error("连接 Redis 失败");
    const store = makeStore(redis);

    const err = await new Promise<Error | null>((resolve) => {
      store.incr("default:1.2.3.4", (e) => resolve(e), 60_000, 300);
    });
    expect(err).toBeInstanceOf(Error);
    expect(redis.warnings).toHaveLength(1);
  });

  it("3. defineCommand 幂等：重复注册不会二次定义", () => {
    const redis = new FakeRedis();
    defineRateLimitCommand(redis as never);
    defineRateLimitCommand(redis as never);
    expect(redis.defined.size).toBe(1);
  });

  it("4. child() 复用同一套计数空间（分档键已包含在 key 里）", async () => {
    const redis = new FakeRedis();
    defineRateLimitCommand(redis as never);
    const store = makeStore(redis);
    const child = store.child();
    await new Promise<void>((resolve) => {
      child.incr("checkout:9.9.9.9", () => resolve(), 60_000, 10);
    });
    expect(redis.commands[0]!.args[0]).toBe("mall:rl:checkout:9.9.9.9");
  });

  it("5. store 构造函数闭包捕获 redis 与前缀", async () => {
    const redis = new FakeRedis();
    defineRateLimitCommand(redis as never);
    const Ctor = makeRedisStoreCtor({ redis: redis as never, prefix: "mall:rl:" });
    const store = new Ctor({});
    await new Promise<void>((resolve) => {
      store.incr("default:1.1.1.1", () => resolve(), 60_000, 300);
    });
    expect(redis.commands[0]!.args[0]).toBe("mall:rl:default:1.1.1.1");
  });
});
