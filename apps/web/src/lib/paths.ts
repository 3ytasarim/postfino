import path from "node:path";
import { existsSync } from "node:fs";

/** Monorepo root (directory containing pnpm-workspace.yaml), searched upward from `start`. */
export function findRoot(start: string = process.cwd()) {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}
