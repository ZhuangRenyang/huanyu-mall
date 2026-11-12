import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * check-module-graph.ts — 模块依赖拓扑检测（架构 §3）。
 * 规则：无环；依赖只能从高编号层指向低编号层（A→B 表示 A 依赖 B，layer(B) < layer(A)）。
 * 依赖来源：packages/modules/<name>/package.json 的 "mall.dependencies" 数组（声明式，权威）。
 */

const ROOT = join(process.cwd(), "packages", "modules");

// 分层表（架构 §3）：数值越大越靠编排层。
const LAYERS: Record<string, number> = {
  core: 0,
  "event-bus": 0,
  "region-channel": 1,
  file: 1,
  customer: 1,
  theme: 1,
  notification: 1,
  product: 2,
  pricing: 2,
  tax: 2,
  promotion: 2,
  inventory: 2,
  cart: 3,
  fulfillment: 3,
  auth: 3,
  review: 3,
  order: 4,
  payment: 4,
  workflows: 5,
};

interface ModuleMeta {
  name: string;
  dependencies: string[];
}

function discoverModules(): ModuleMeta[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const pkgPath = join(ROOT, d.name, "package.json");
      if (!existsSync(pkgPath)) return null;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        name?: string;
        mall?: { dependencies?: string[] };
      };
      const name = (pkg.name ?? "").replace(/^@mall\//, "");
      if (!name) return null;
      const deps = pkg.mall?.dependencies ?? [];
      return { name, dependencies: deps };
    })
    .filter((m): m is ModuleMeta => m !== null);
}

function check(): void {
  const modules = discoverModules();
  if (modules.length === 0) {
    console.log("PASS: 未发现领域模块（packages/modules/*），模块图为空。");
    process.exit(0);
  }

  const known = new Set(modules.map((m) => m.name));
  const errors: string[] = [];

  // 1) 未知依赖 + 层校验
  for (const m of modules) {
    const layer = LAYERS[m.name];
    if (layer === undefined) {
      errors.push(`模块 ${m.name} 未声明分层，请加入 LAYERS`);
      continue;
    }
    for (const dep of m.dependencies) {
      if (!known.has(dep)) {
        errors.push(`模块 ${m.name} 依赖未知模块 ${dep}`);
        continue;
      }
      const depLayer = LAYERS[dep];
      if (depLayer === undefined) continue;
      if (depLayer >= layer) {
        errors.push(
          `跨层/反向依赖：${m.name}(L${layer}) → ${dep}(L${depLayer})，要求 layer(dep) < layer(src)`,
        );
      }
    }
  }

  // 2) 环检测（Kahn）
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const m of modules) {
    indegree.set(m.name, 0);
    outgoing.set(m.name, []);
  }
  for (const m of modules) {
    for (const dep of m.dependencies) {
      if (!outgoing.has(dep)) continue;
      outgoing.get(m.name)!.push(dep);
      indegree.set(dep, indegree.get(dep)! + 1);
    }
  }
  const queue = modules.filter((m) => indegree.get(m.name) === 0).map((m) => m.name);
  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const next of outgoing.get(node)!) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (sorted.length !== modules.length) {
    const cyclic = modules.filter((m) => !sorted.includes(m.name)).map((m) => m.name);
    errors.push(`存在依赖环：${cyclic.join(", ")}`);
  }

  if (errors.length > 0) {
    console.error("FAIL:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`PASS: ${modules.length} 个模块，依赖图无环且分层正确。`);
}

check();
