import type { Token } from "./types.js";

/**
 * Kahn 拓扑排序。edges: from → to[]（from 依赖 to）。
 * 输出顺序 = 依赖在前（to 先于 from），供启动顺序使用。
 * 存在环或未知依赖时抛错。
 */
export function topologicalSort(nodes: Token[], edges: Map<Token, Token[]>): Token[] {
  const indegree = new Map<Token, number>();
  const dependents = new Map<Token, Token[]>();
  for (const node of nodes) {
    indegree.set(node, 0);
    dependents.set(node, []);
  }

  for (const [from, deps] of edges) {
    if (!indegree.has(from)) throw new Error(`Unknown node in edges: ${String(from)}`);
    for (const dep of deps) {
      if (!indegree.has(dep)) throw new Error(`Unknown dependency: ${String(dep)}`);
      dependents.get(dep)!.push(from);
      indegree.set(from, indegree.get(from)! + 1);
    }
  }

  const queue = nodes.filter((n) => indegree.get(n) === 0);
  const result: Token[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const dependent of dependents.get(node)!) {
      indegree.set(dependent, indegree.get(dependent)! - 1);
      if (indegree.get(dependent) === 0) queue.push(dependent);
    }
  }

  if (result.length !== nodes.length) {
    const cyclic = nodes.filter((n) => !result.includes(n)).map(String);
    throw new Error(`Circular dependency detected: ${cyclic.join(", ")}`);
  }
  return result;
}
