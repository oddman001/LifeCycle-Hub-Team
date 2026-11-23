# 运行、验收与团队仓库同步指南

本指南对应目前的代码（五模块免费模型 AI 识别 + 本机注册登录）。分三部分：

1. 第一次在本机运行（精确到点哪里）
2. 开启免费 AI 识别与日常使用
3. 把改动同步到团队 GitHub 仓库（含 PR 流程）

> 本工作副本是从 ZIP 解压的，没有 `.git` 目录。要同步到 GitHub，按第 3 部分操作；不要直接在当前副本里 `git init` 覆盖团队历史，推荐“克隆新目录 → 覆盖改动文件”的方式。

---

## 1. 第一次运行

### 1.1 安装 Node.js

1. 打开浏览器访问 <https://nodejs.org/>。
2. 点绿色大按钮 **Download Node.js (LTS)**，下载 Windows Installer（`.msi`）。
3. 双击安装包 → 一路点 **Next** → 勾选同意协议 → **Install** → **Finish**。
4. 安装完成后**关掉所有已打开的命令行窗口**（否则 PATH 不生效）。

验证：按 `Win + R`，输入 `cmd`，回车，在黑窗口输入：

```bat
node -v
```

显示 `v24.x.x` 即可。若提示“不是内部或外部命令”，重启电脑后再试。

### 1.2 准备项目目录

1. 把 `LifeCycle-Hub-Team-main` 文件夹解压到容易找的位置，例如：

   ```text
   C:\Users\你的用户名\LifeCycle-Hub-Team-main
   ```

   建议不要放在 OneDrive 同步目录里，避免运行时数据库文件被同步锁占用。
2. 双击进入该文件夹，确认能看到 `start-local.cmd`、`package.json`、`README.md`。

### 1.3 启动

1. 双击 **`start-local.cmd`**。
   - 若出现“Windows 已保护你的电脑”蓝框：点 **更多信息** → **仍要运行**。
2. 会弹出一个黑色命令行窗口，依次显示构建信息和：

   ```text
   Team edition: http://127.0.0.1:8080/ (press Ctrl+C to stop)
   ```

3. 浏览器会自动打开 `http://127.0.0.1:8080/`。**如果没有自动打开**，把上面那行地址复制到浏览器地址栏回车。
4. 这个黑窗口要一直开着；关闭窗口或按 `Ctrl+C` 就会停止服务。

> 端口被占用时会自动改用 `http://127.0.0.1:8081/`，以窗口里实际打印的地址为准。
> 重复双击 `start-local.cmd` 不会启动第二个实例，会直接复用正在运行的服务并打开浏览器。

### 1.4 第一次打开：注册本机账号

第一次打开会跳到注册页（地址是 `/register`）：

1. **用户名**：3–32 个字符，只能用英文字母、数字、`.`、`-`、`_`，且第一个字符必须是字母或数字。例：`xiaoming`。
2. **密码**：至少 8 位，且需同时包含大写字母、小写字母和数字（输入框下方会用小标签列出这四条规则）。
3. **确认密码**：再输入一次。
4. 点蓝色按钮 **创建并进入**。
5. 成功后进入首页。每个页面顶部会出现 **账户栏**：左边是用户名首字母头像、用户名和注册时间，右边是 **个人信息** 与 **退出登录**。点左上角 **菜单**，导航列表最后一项也会显示 **我的账号 · xiaoming**。

说明：

- 账号、密码哈希和登录会话都只保存在本机 SQLite 里，不会上传。
- 同一台电脑上的所有账号**共用同一份数据**（账号只用来确认“是谁在用电脑”），所以升级后原有记录不会丢。
- 登录页、注册页与登录后的页面使用同一套蓝紫粉色调；登录页保留纸张卡片和衬线标题，切换前后像同一个地方，不会割裂。
- 之后再打开会先看到登录页（`/login`），输入用户名密码点 **登录** 即可。

### 1.5 界面导航（点哪里）

- 左上角 **菜单** 按钮 → 打开「导航菜单」抽屉，里面有：
  - **总览**（首页）
  - **食品 / 药品 / 衣物 / 电子设备 / 会员订阅**
  - **我的账号**
- 首页中间有 **＋快速录入** 按钮 → 弹窗里选五个模块之一。
- 每个模块页面顶部有 **快速录入** 与 **手动录入** 切换按钮，以及返回箭头。

### 1.6 五个模块的快速录入（AI/规则通用步骤）

以食品为例：

1. 首页点 **＋快速录入** → 点 **食品**（或菜单 → 食品 → **快速录入**）。
2. 在「描述食品」文本框输入一句话，例如：
   `刚才买了两桶方便面，放在柜子里了`。
3. 点 **提取信息**。
4. 进入核对页，逐项检查名称、数量、购买时间、存放位置；页面顶部会标明来源：
   - **AI 识别结果 / AI 提取**（配置了模型）
   - **文字规则提取 / 规则提取**（没配置模型或调用失败）
5. 确认无误后点 **确认并保存**；不想保存就点 **取消**。

其他四个模块同样的“输入描述 → 提取信息 → 核对 → 保存”流程：

| 模块 | 入口 | 说明 |
|---|---|---|
| 药品 | 菜单 → 药品 → 快速录入 | 识别名称、规格、数量、用法等，核对后保存批次 |
| 衣物 | 菜单 → 衣物 → 快速录入 | 识别名称、价格、材质、购买时间；购买时间含糊时需手动选年份/日期 |
| 电子设备 | 菜单 → 电子设备 → 快速录入 | 识别名称、型号、价格、配置、购买渠道 |
| 会员订阅 | 菜单 → 会员订阅 → 快速录入 | 识别名称、费用、周期、续费日期 |

### 1.7 账号操作

1. 登录后每个页面顶部都有 **账户栏**：左边是头像、用户名和注册时间，右边是 **个人信息** 和 **退出登录**。
   - 点 **个人信息** 打开 `/account`，可看到用户名、注册时间、数据位置，并修改密码。
   - 点 **退出登录**（或账户栏右侧的退出按钮）回到登录页。
2. 也可以点左上角 **菜单** → **我的账号**（导航列表最后一项）。
3. 修改密码：填 **当前密码**、**新密码**、**确认新密码** → 点 **修改密码**。新密码同样要求至少 8 位并同时包含大写字母、小写字母和数字。
   修改后其他已登录会话自动失效，当前会话保持登录。
4. 退出：点 **退出登录**，回到登录页。
5. 忘记密码：本机账号没有邮箱找回。可以再注册一个新账号继续使用（数据共享）；或先备份数据目录，再让负责人清理数据库中的 `LocalAccount` 表。

---

## 2. 开启免费 AI 识别（可选）

不配置也能用，只是五个模块走本地文字规则。配置后识别页顶部会显示当前模型，例如
`免费模型 · 本地 Ollama · qwen2.5:7b`。

三种免费方式任选一种。**环境变量只对当前 PowerShell 窗口生效**，所以要在同一个窗口里启动程序。

### 方式 A：本机 Ollama（免费、无需密钥、可离线）

1. 访问 <https://ollama.com/download>，下载 Windows 安装包并安装；安装后任务栏会出现 Ollama 图标（表示服务在运行）。
2. 打开 PowerShell：在项目文件夹空白处 **Shift + 右键** → **在此处打开 PowerShell 窗口**（或 Win+R 输入 `powershell` 后 `cd` 到项目目录）。
3. 下载模型（约 4–5 GB，只需一次）：

   ```powershell
   ollama pull qwen2.5:7b
   ```

4. 设置服务商并启动：

   ```powershell
   $env:AI_PROVIDER = 'ollama'
   .\start-local.cmd
   ```

5. 验证：菜单 → 食品 → **快速录入**，页面提示应显示
   `已启用文字 AI 识别（免费模型 · 本地 Ollama · qwen2.5:7b）`；
   输入一句话点 **提取信息**，核对页顶部会显示 **AI 提取**（食品）或 **AI 识别结果**（其他模块）。

> 电脑内存建议 8 GB 以上；第一次识别会慢几秒到十几秒。
> 如果提示“无法连接本地模型服务”，确认 Ollama 正在运行，并重新执行 `ollama pull`。

### 方式 B：智谱 GLM-4-Flash（有免费额度，需要密钥）

1. 打开 <https://open.bigmodel.cn/> 注册并登录。
2. 进入控制台，找到 **API Keys**（或“密钥管理”）→ **创建 API Key** → 复制密钥（形如 `xxxx.xxxx`）。
3. 在项目目录打开 PowerShell：

   ```powershell
   $env:AI_PROVIDER = 'zhipu'
   $env:AI_API_KEY  = '粘贴你的密钥'
   .\start-local.cmd
   ```

4. 验证方式同上，模型标签应为 `免费模型 · 智谱 GLM · glm-4-flash`。

### 方式 C：OpenRouter 免费模型（需要密钥）

1. 打开 <https://openrouter.ai/> 注册登录。
2. 右上角头像 → **Keys** → **Create Key** → 复制密钥（`sk-or-...`）。
3. 在项目目录打开 PowerShell：

   ```powershell
   $env:AI_PROVIDER = 'openrouter'
   $env:AI_API_KEY  = 'sk-or-你的密钥'
   .\start-local.cmd
   ```

4. 验证方式同上，模型标签应为 `免费模型 · OpenRouter · meta-llama/llama-3.3-70b-instruct:free`。

### 用 .env 文件保存配置（推荐日常使用）

1. 在项目目录找到 `.env.example`，复制一份并改名 `.env`（右键 → 复制 → 粘贴 → 重命名为 `.env`）。
2. 用记事本打开 `.env`，取消注释并填写，例如：

   ```ini
   AI_PROVIDER=ollama
   ```

   或：

   ```ini
   AI_PROVIDER=zhipu
   AI_API_KEY=你的密钥
   ```

3. 保存后重新双击 `start-local.cmd`。真实环境变量优先于 `.env`。

> `.env` 已被 `.gitignore` 忽略，**不要提交密钥**；密钥也不会写入数据库或页面。

### 其他服务

`AI_PROVIDER` 还支持 `deepseek`、`moonshot`、`dashscope`、`openai`、`custom`；显式设置 `AI_BASE_URL` 时地址优先，`AI_MODEL` 可覆盖预设模型。没有配置时页面显示“未配置 AI 识别”，自动使用本地规则。

---

## 3. 日常使用与维护

- **停止**：在启动窗口按 `Ctrl+C`。
- **重启**：再次双击 `start-local.cmd`。
- **换端口**：PowerShell 里 `$env:PORT='8090'` 后 `.\start-local.cmd`。
- **数据位置**：`%LOCALAPPDATA%\LifeCycleHub-Team\data\team.sqlite`（上传目录同级的 `uploads`）。
- **备份**：先停止服务，把整个 `%LOCALAPPDATA%\LifeCycleHub-Team` 复制到备份位置。
- **恢复**：停止服务，用备份覆盖同名目录，再启动。
- **换代码目录**：数据在用户目录，换项目文件夹不影响数据。
- **关闭登录**：在 `.env` 写 `LOCAL_ACCOUNTS=off`，重启后直接进入首页（旧的无账号模式）；删掉该行重启会重新要求登录。
- **升级数据库**：启动时自动执行未应用的迁移，迁移前会在数据目录生成 `.before-migration-时间戳.sqlite` 快照。

---

## 4. 本地验证（提交前必做）

在项目目录打开 PowerShell：

```powershell
node build.mjs --test-legacy
node --test smoke.test.mjs home-ui.test.mjs browser-filter.test.mjs device.test.mjs subscription.test.mjs entry-ui.test.mjs date-picker-only.test.mjs home-colors.test.mjs quick-ai.test.mjs free-ai.test.mjs expiry-intake.test.mjs local-auth.test.mjs env-file.test.mjs
```

预期最后显示：

```text
ℹ tests 13
ℹ pass 13
ℹ fail 0
```

如果 `npm` 提示“无法加载文件……禁止运行脚本”，是 PowerShell 执行策略限制，任选其一：

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
npm test
```

或直接改用 `npm.cmd test`、`cmd /c npm test`。

---

## 5. 同步到团队仓库

### 5.1 先确认三个地址

| 用途 | 地址 | 说明 |
|---|---|---|
| 你手上的仓库 | `https://github.com/oddman001/LifeCycle-Hub-Team` | 最初的仓库链接 |
| 团队主仓库 | `https://github.com/CanyangChen/LifeCycle-Hub-Team` | README 与 CODEOWNERS 指向这里 |

打开这两个页面看一眼：

- 如果 `oddman001/LifeCycle-Hub-Team` 页面标题下方写着 **forked from CanyangChen/LifeCycle-Hub-Team**，说明它只是你的 fork，PR 要提到 `CanyangChen/LifeCycle-Hub-Team` 的 `main`。
- 如果你有 `CanyangChen` 仓库的 **Settings → Collaborators** 权限（或你就是负责人），也可以直接推功能分支到团队仓库。
- 下面命令里的 `origin` 指你自己的仓库，`upstream` 指团队主仓库，按实际情况替换账号名。

### 5.2 安装 Git 并配置身份

1. 访问 <https://git-scm.com/download/win>，下载安装（一路 Next 即可）。
2. 关掉旧窗口，重新打开 PowerShell，验证：

   ```powershell
   git --version
   ```

3. 配置姓名和邮箱（只需一次，邮箱用你 GitHub 账号的邮箱）：

   ```powershell
   git config --global user.name "你的名字"
   git config --global user.email "你的邮箱@example.com"
   git config --global init.defaultBranch main
   ```

### 5.3 克隆仓库到新目录（不要覆盖当前运行副本）

```powershell
cd C:\Users\你的用户名\Documents
git clone https://github.com/oddman001/LifeCycle-Hub-Team.git LifeCycle-Hub-Team-git
cd LifeCycle-Hub-Team-git
git remote -v
```

如果你希望从团队主仓库拉最新代码，再加一个上游远程：

```powershell
git remote add upstream https://github.com/CanyangChen/LifeCycle-Hub-Team.git
git fetch upstream
```

### 5.4 把本次改动复制进去

把下面这些文件从当前 `LifeCycle-Hub-Team-main` 复制到克隆目录（同名覆盖）：

**新增文件**

- `local-auth.mjs`
- `drizzle/0016_local_auth.sql`
- `free-ai.test.mjs`
- `expiry-intake.test.mjs`
- `local-auth.test.mjs`
- `docs/run-and-sync-guide.md`（本文档）
- `docs/demo-samples.md`（五模块示范样本）

**修改文件**

- `intake-provider.mjs`
- `intake.mjs`
- `food-dates.mjs`
- `food.mjs`
- `browser.mjs`
- `ui-shared-components.css`
- `drug-intake.mjs`
- `wardrobe.mjs`
- `worker.mjs`
- `build.mjs`
- `standalone.mjs`
- `drizzle/meta/_journal.json`
- `package.json`
- `README.md`
- `.env.example`
- `CHANGELOG.md`

复制完先检查：

```powershell
git status --short
```

应当只看到上面这些文件的 `M`（修改）和 `??`（新增）。**不应出现** `dist/`、`test-results/`、`.env`、`*.sqlite`、`node_modules`（这些已被 `.gitignore` 忽略）。

### 5.5 在克隆目录再验证一次

```powershell
node build.mjs --test-legacy
node --test smoke.test.mjs home-ui.test.mjs browser-filter.test.mjs device.test.mjs subscription.test.mjs entry-ui.test.mjs date-picker-only.test.mjs home-colors.test.mjs quick-ai.test.mjs free-ai.test.mjs expiry-intake.test.mjs local-auth.test.mjs env-file.test.mjs
```

必须 12/12 通过再提交。

### 5.6 建分支并提交

```powershell
git switch -c feature/free-ai-local-login
git add -A
git status --short
git commit -m "feat: 五模块接入免费模型 AI 识别并新增本机注册登录" -m "- AI_PROVIDER 预设 ollama（免密钥）/ zhipu / openrouter，回环地址不再发送 Authorization
- 识别页显示当前模型；未配置时回退本地规则
- 新增 0016 本机账号迁移、注册/登录/改密/退出与 LOCAL_ACCOUNTS 开关
- 同机账号共用数据，云端演示仍按账号隔离
- 修复保质期（月/年/周换算、保质期到某日）与长段口语物品名称、多物品拆分
- 新增 free-ai.test.mjs、expiry-intake.test.mjs、local-auth.test.mjs，回归 13/13 通过"
```

> 想拆成多个提交也可以：先只 `git add` AI 相关文件提交一次，再 `git add` 账号相关文件提交一次；`worker.mjs` 同时包含两类改动，可用 `git add -p worker.mjs` 分段暂存（较繁琐，非必须）。

### 5.7 推送分支

推到自己的 fork：

```powershell
git push -u origin feature/free-ai-local-login
```

如果你有团队仓库写权限、想直接推到团队仓库：

```powershell
git push upstream feature/free-ai-local-login
```

### 5.8 在 GitHub 网页创建 Pull Request

1. 推送后打开自己的仓库页面，顶部会出现黄色提示条 **Compare & pull request**，点它。
   （没看到就点 **Pull requests** → **New pull request**。）
2. 设置方向：
   - **base repository**：`CanyangChen/LifeCycle-Hub-Team`（团队主仓库）
   - **base**：`main`
   - **head repository**：你的仓库
   - **compare**：`feature/free-ai-local-login`
3. 标题填：`feat: 五模块接入免费模型 AI 识别并新增本机注册登录`
4. 描述会自动带出 `.github/PULL_REQUEST_TEMPLATE.md`，逐项填写：
   - 修改内容：免费模型预设 + 本机账号
   - 影响模块：五个业务模块、账号、启动、数据库
   - 测试结果：勾选 `npm run build`、`npm test`，写本机 Windows + Node 版本，并注明真实模型/手机未验收
   - 数据库变更：列出 `drizzle/0016_local_auth.sql`，说明新增三张表、旧库自动迁移并生成快照
   - 最后勾选“无真实数据库、个人数据或密钥”
5. 点 **Create pull request**。
6. 等待右侧 **Team CI / Build and regression** 变绿。
7. 由于改了 `drizzle/`，`.github/CODEOWNERS` 会要求 **@CanyangChen** 审核；在右侧 **Reviewers** 选择一位组员，等审核通过。
8. 审核通过后点绿色 **Squash and merge** → **Confirm squash and merge** → **Delete branch**（删除的是功能分支，不是 main）。

### 5.9 合并后收尾

```powershell
git switch main
git pull origin main
git branch -d feature/free-ai-local-login
```

（如果 `main` 在上游，用 `git pull upstream main`。）

### 5.10 分支落后或冲突

PR 页面提示 “This branch has conflicts” 时：

```powershell
git fetch upstream
git switch feature/free-ai-local-login
git rebase upstream/main
```

- 冲突文件用编辑器打开，按 `<<<<<<< / ======= / >>>>>>>` 标记合并，然后 `git add 冲突文件`、`git rebase --continue`。
- `drizzle/meta/_journal.json` 常见冲突：保留双方条目，按 `idx` 递增且不重复。
- 解决后重跑第 4 部分测试，再推分支：

  ```powershell
  git push --force-with-lease origin feature/free-ai-local-login
  ```

  `--force-with-lease` 只用于自己的功能分支；**严禁**对 `main` 强推。

### 5.11 常见问题

| 现象 | 处理 |
|---|---|
| `git push` 提示 `Authentication failed` / 403 | GitHub 已不接受密码。用 Git Credential Manager 弹窗登录，或在 GitHub **Settings → Developer settings → Personal access tokens** 生成 token，密码处粘贴 token |
| `failed to push some refs`（non-fast-forward） | 先 `git pull --rebase origin main`（或 upstream），解决冲突后再推；不要强推 main |
| 误把 `.env` / `*.sqlite` 加进暂存区 | 停止提交，执行 `git rm --cached .env`（或对应文件），确认 `.gitignore` 生效后重新 `git add -A` 提交 |
| 中文文件名/内容乱码 | 确保文件保存为 UTF-8；`git config --global core.autocrlf true`；提交前 `git diff` 检查 |
| 不想用命令行建 PR | 在 GitHub 网页 **Add file → Upload files** 也能上传，但会丢失提交历史；团队仍要求走分支 + PR，建议用上面的 Git 流程 |
| 克隆太慢/失败 | 换网络或用 `git clone --depth 1` 只拉最新一次提交（后续 PR 仍可用） |

### 5.12 提交前检查清单

- [ ] 第 4 部分测试 12/12 通过
- [ ] `git status --short` 只有预期的源码/文档，没有数据库、`.env`、`dist/`、`test-results/`
- [ ] `CHANGELOG.md`「未发布」已补充
- [ ] README / `.env.example` 已说明新配置项
- [ ] 数据库迁移随 PR 提交并注明旧库升级方式
- [ ] PR 描述里写清“真实模型、拍照/语音、云端账号未验收”，不夸大完成度

---

## 附：命令速查

```powershell
# 启动（双击 start-local.cmd 等效）
.\start-local.cmd

# 指定端口
$env:PORT='8090'; .\start-local.cmd

# 免费模型
$env:AI_PROVIDER='ollama'; .\start-local.cmd
$env:AI_PROVIDER='zhipu'; $env:AI_API_KEY='密钥'; .\start-local.cmd

# 关闭登录（也可写进 .env）
$env:LOCAL_ACCOUNTS='off'; .\start-local.cmd

# 测试
node build.mjs --test-legacy
node --test smoke.test.mjs home-ui.test.mjs browser-filter.test.mjs device.test.mjs subscription.test.mjs entry-ui.test.mjs date-picker-only.test.mjs home-colors.test.mjs quick-ai.test.mjs free-ai.test.mjs expiry-intake.test.mjs local-auth.test.mjs env-file.test.mjs

# 提交流程
git switch -c feature/主题
git add -A
git commit -m "feat(模块): 说明"
git push -u origin feature/主题
```
