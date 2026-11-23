// 生成一个随机邀请码及其 SHA-256，用于云端演示站注册。
// 用法：node tools/cloud/invite-code.mjs [个数]
import { createHash, randomBytes } from "node:crypto";

const count = Math.max(1, Math.min(20, Number.parseInt(process.argv[2] ?? "1", 10) || 1));
const hashes = [];
for (let index = 0; index < count; index += 1) {
  const code = "LCH-" + randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(code).digest("hex");
  hashes.push(hash);
  console.log(`邀请码：${code}`);
  console.log(`SHA-256：${hash}\n`);
}
console.log("把上面的 SHA-256 用空格连接后写入 secret（多个邀请码用空格分隔）：");
console.log(`  npx wrangler secret put DEMO_INVITATION_HASHES`);
console.log(`  ${hashes.join(" ")}`);
