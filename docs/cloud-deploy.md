# 部署到云端（Cloudflare Workers + D1）

本文是 LifeCycle Hub 的云端部署方案与操作手册。云端模式即团队仓库原本设计的「演示站」：
邀请码注册、每个账号一份独立数据、SQLite 语法但存在 Cloudflare D1 里。

## 一、方案概览

| 项目 | 说明 |
| --- | --- |
| 运行形态 | Cloudflare Workers（单文件 `dist/server/index.js`，无需静态资源绑定） |
| 数据库 | Cloudflare D1（免费额度 5 GB，按账号隔离成 `w_<id>_` 前缀的表） |
| 登录 | 邀请码注册 + 用户名密码登录，密码至少 12 位，会话 Cookie 为 `Secure` 的 `__Host-` Cookie |
| 访问地址 | 默认 `https://lifecycle-hub.<你的子域>.workers.dev`，也可以绑定自己的域名 |
| 费用 | Workers 免费版每天 10 万请求、D1 免费 5 GB，课堂演示足够 |

为什么选它：项目本来就是 Worker + D1 架构，构建产物是自包含的单个 JS 文件；
不需要额外买服务器，也不需要给 SQLite 文件找持久磁盘。

## 二、前置条件

- 一个 Cloudflare 账号（免费注册：https://dash.cloudflare.com/sign-up ）
- 本机 Node.js 20 以上（项目当前用 Node 24/26 都可以）
- 在 `LifeCycle-Hub-Team-main` 目录下打开 PowerShell

下文用 `$W` 代表 wrangler 的入口；为了不污染团队 `package.json` 和 CI，
建议把它装在临时目录：

```powershell
$W = "$env:TEMP\wrangler-tool\node_modules\wrangler\bin\wrangler.js"
npm.cmd install --prefix "$env:TEMP\wrangler-tool" --no-save --no-audit --no-fund wrangler@4
node $W --version
```

## 三、首次部署（约 10 分钟）

### 1. 登录 Cloudflare

```powershell
node $W login
```

浏览器会打开授权页，点 **Allow**。登录状态保存在 `%USERPROFILE%\.wrangler`，之后不用再登录。
（也可以使用 API Token：在 Cloudflare 控制台创建带 *Workers Scripts:Edit* 和 *D1:Edit*
权限的 Token，然后 `$env:CLOUDFLARE_API_TOKEN="..."`，效果相同。）

确认登录：`node $W whoami`

### 2. 创建 D1 数据库

```powershell
node $W d1 create lifecycle-hub
```

命令会打印 `database_id`，把它填进 `wrangler.toml` 的 `[[d1_databases]]` 段，
替换掉 `00000000-0000-0000-0000-000000000000`。

### 3. 建表（应用迁移）

云端只需要业务表和演示账号表；本机账号迁移（`0016_local_auth`）不应用到云端。

```powershell
node tools/cloud/collect-migrations.mjs
node $W d1 migrations apply lifecycle-hub --remote --migrations-dir .cloud-migrations
```

看到 `Migrations applied` 即成功。之后如果团队新增迁移，重复这两条命令即可。

### 4. 生成邀请码并写入密钥

```powershell
node tools/cloud/invite-code.mjs 3
```

它会打印 3 个邀请码（形如 `LCH-xxxxxxxx...`）和对应的 SHA-256。
把邀请码私发给组员；把 **SHA-256 用空格连接**后写入 secret：

```powershell
node $W secret put DEMO_INVITATION_HASHES
# 粘贴：hash1 hash2 hash3，回车
```

> 邀请码只以 SHA-256 形式存在云端，忘了只能重新生成。
> 邀请码长度必须在 24–64 位之间，`invite-code.mjs` 生成的都满足。

### 5. 构建并部署

```powershell
node build.mjs
node $W deploy
```

部署成功后会打印地址，例如：

```
https://lifecycle-hub.your-subdomain.workers.dev
```

### 6. 回填公开地址并重新部署

把 `wrangler.toml` 里的 `DEMO_PUBLIC_ORIGIN` 改成上一步的真实地址（必须是 HTTPS），
然后 `node $W deploy` 再部署一次。

登录和注册会校验请求来源，地址不对会提示「请求来源无效」。

### 7. 验证清单

- 打开 `https://<你的地址>/login`，应看到登录页（不是 503）
- 点「使用邀请码开户」，用邀请码 + 用户名 + 至少 12 位密码注册，应直接进入首页
- 首页左上「菜单」→「我的账号」可以改密码
- 五个模块各保存一条记录，刷新后仍在
- 换一个浏览器/隐身窗口注册第二个账号，两个账号的数据互不可见

## 四、日常更新

```powershell
node build.mjs
node tools/cloud/collect-migrations.mjs
node $W d1 migrations apply lifecycle-hub --remote --migrations-dir .cloud-migrations   # 有新迁移时
node $W deploy
```

## 五、运维

| 操作 | 命令 |
| --- | --- |
| 查看实时日志 | `node $W tail lifecycle-hub` |
| 导出备份 | `node $W d1 export lifecycle-hub --remote --output backup-2026-11-22.sql` |
| 恢复 | 先建临时库演练：`node $W d1 execute <库名> --remote --file backup.sql` |
| 回滚代码 | `node $W rollback <版本ID>`（`node $W deployments list` 查看版本） |
| 删除站点 | `node $W delete lifecycle-hub` |
| 删除数据库 | `node $W d1 delete lifecycle-hub` |

自定义域名：Cloudflare 控制台 → Workers & Pages → lifecycle-hub → Settings → Domains & Routes。
绑定后把 `DEMO_PUBLIC_ORIGIN` 改成新域名再部署。

## 六、常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 打开就 503「演示站登录暂不可用」 | `DEMO_ACCOUNT_MODE` 或 `DEMO_PUBLIC_ORIGIN` 没配置；检查 `wrangler.toml` 的 `[vars]` |
| 注册时报 403「请求来源无效」 | `DEMO_PUBLIC_ORIGIN` 与实际访问地址不一致，改成实际地址后重新部署 |
| 邀请码提示无效 | hash 没写进 secret、写错了，或邀请码长度不足 24；重新 `secret put` 并重新部署 |
| 迁移报 `table ... already exists` | 云端已有旧库，先 `node $W d1 execute lifecycle-hub --remote --command "SELECT name FROM d1_migrations"` 核对 |
| 注册密码总被拒 | 云端密码至少 12 位（比本机 8 位更严） |
| 中文日志乱码 | 终端用 UTF-8；`chcp 65001` |

## 七、安全提醒

- 邀请码只发给组员，不要写进 README、群公告或 Git 仓库
- `DEMO_INVITATION_HASHES` 用 secret 保存，`wrangler.toml` 里只有占位符
- 每个账号的数据通过 `w_<账号 id>_` 前缀隔离；不要把管理员账号借给别人
- 演示数据不要放真实身份证号、处方、住址等敏感信息

## 八、本地预演云端模式（不花钱先跑通）

在没有 Cloudflare 账号时，可以先用本机模拟云端模式：

```powershell
$h = node -e "console.log(require('node:crypto').createHash('sha256').update('LCH-demo-invite-1234567890').digest('hex'))"
$env:DEMO_PUBLIC_ORIGIN="http://127.0.0.1:8123"
$env:DEMO_INVITATION_HASHES=$h
$env:DEMO_DB_PATH="$env:TEMP\demo-cloud.sqlite"
$env:PORT=8123
node standalone.mjs
```

浏览器打开 `http://127.0.0.1:8123/`，用邀请码 `LCH-demo-invite-1234567890`
和至少 12 位密码注册，流程与线上一致（本仓库已用这条链路做过冒烟验证）。
