// 收集云端需要的数据库迁移：drizzle 里除了本机账号（*_local_*）之外全部复制到 .cloud-migrations，
// 供 `wrangler d1 migrations apply` 使用。用法：node tools/cloud/collect-migrations.mjs
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const journal = JSON.parse(await readFile(join(root, "drizzle/meta/_journal.json"), "utf8"));
const target = join(root, ".cloud-migrations");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

const copied = [];
const skipped = [];
for (const entry of journal.entries) {
  if (/_local_/.test(entry.tag)) {
    skipped.push(entry.tag);
    continue;
  }
  const sql = await readFile(join(root, "drizzle", `${entry.tag}.sql`), "utf8");
  await writeFile(join(target, `${entry.tag}.sql`), sql);
  copied.push(entry.tag);
}

console.log(`已生成 ${target}`);
console.log(`包含 ${copied.length} 个迁移：`);
for (const tag of copied) console.log(`  ${tag}`);
if (skipped.length) console.log(`跳过仅本机使用的迁移：${skipped.join(", ")}`);
