# LifeCycle Hub 团队本地版

这是课程团队的 Windows 本地 Web 项目，用来管理食品、药品、衣物、电子设备及会员订阅。
每位组员运行自己的程序，数据只保存在自己的 Windows 用户目录。启动和使用无需 GitHub、
ChatGPT、邀请码或网络连接。手动录入和文字规则提取可离线使用；配置 AI 后，五个模块的快速
记录都可选用免费模型识别（本机 Ollama，或智谱 GLM-4-Flash、OpenRouter 免费模型），调用失败
自动回退本地规则。本机版自带注册与登录页，用于确认“是谁在用这台电脑”。

## 当前交接版本（2026-11-20）

四轮 UI 优化已同步至团队分支 **`codex/ui-v25-handoff`**，代码基线为 `678961c`。团队 `main` 尚未合并这些变更；下载或测试时请明确选择交接分支，不要将默认 main 当作最新 UI。

本轮包含五模块主要录入表单、按钮与返回入口统一、文字和空状态规范化、首页 V2.5 配色及食品日历星期标题配色。保留各模块原有业务逻辑和团队本地启动方案。没有复制个人数据库、账号密码、上传文件或密钥，也没有引入个人仓库 Git 历史。

### 获取交接分支

首次使用 Git 的组员：

```powershell
git clone --branch codex/ui-v25-handoff https://github.com/CanyangChen/LifeCycle-Hub-Team.git
Set-Location LifeCycle-Hub-Team
.\start-local.cmd
```

已有副本的组员先停止服务并备份自己的数据，确认工作区干净后执行：

```powershell
git status --short
git fetch origin
git switch codex/ui-v25-handoff
git pull --ff-only origin codex/ui-v25-handoff
.\start-local.cmd
```

有未提交修改、拉取失败或分支切换失败时停止，请负责人协助，不要丢弃修改或重置数据库。ZIP 用户在 GitHub 分支选择器选择 `codex/ui-v25-handoff` 后再下载 ZIP。

### 验证与后续分工

在项目目录运行：

```powershell
npm test
```

该命令先构建，再运行食品、药品、设备、订阅、首页、筛选、录入入口、日期选择、颜色对比度、AI 免费模型、保质期与长段文字识别、本机账号及环境变量等现有回归检查。交接基线构建与 13 个测试文件通过；自动化通过不等于实际 PC/手机和云端环境已验收。

后续由组员负责：

- 五模块 PC 与移动端完整操作、截图、布局和高亮度屏幕验收。
- 云端账号登录、会话、注册/邀请码及后端跨账号权限检查。本机版的注册/登录已实现（仅用于确认身份，本机数据由所有账号共用），不代表云端认证已完成验收。
- 独立测试数据库、迁移、文件存储、备份与恢复验证。
- 云端部署方案与实施评估，包括身份认证、数据隔离、密钥、持久化和中国大陆可访问性；当前仍以本地 Web 运行，不要求先部署云端。可选的 Cloudflare Workers + D1 实施方案已整理在 [云端部署手册](docs/cloud-deploy.md)。

详见 [阶段交接说明](docs/team-handoff.md) 与 [首页颜色检查记录](docs/ui015-home-v25-review.md)。组员从交接分支创建各自 feature/fix 分支，通过 PR 审查；验收后再合并团队 main。快速记录的 AI 识别已接入并可回退本地规则，但真实模型、拍照/语音、后台调度等未实际验收的能力不得标记完成。

## 第一次使用

1. 从 https://nodejs.org/ 安装 Node.js 24 LTS。安装后重新打开终端。
2. 在团队仓库页面点 Code → Download ZIP，解压到自己的文件夹。也可以用 Git 克隆。
3. 项目没有第三方运行依赖，双击启动脚本前无需安装依赖。若需要验证锁文件，
   在项目目录运行 npm ci --ignore-scripts。
4. 双击 start-local.cmd，按窗口提示打开 http://127.0.0.1:8080/ 或 8081。
   第一次打开先注册一个本机账号，进入后会建库并添加虚构样例。每位组员都可自行编辑样例和创建记录。
5. 关闭浏览器不会停止服务。需要停止时，在启动窗口按 Ctrl+C。关闭后可双击重新启动。

## 开启 AI 识别（可选，支持免费模型）

快速记录默认使用本地文字规则，完全离线。想用 AI 识别时，从下面选一种免费方式，在启动用的 PowerShell 窗口设置环境变量，再运行启动脚本。

### 方式一：本机 Ollama（免费、无需密钥、可离线）

先安装 [Ollama](https://ollama.com/download)，下载模型后保持服务运行：

```powershell
ollama pull qwen2.5:7b
$env:AI_PROVIDER = 'ollama'
.\start-local.cmd
```

默认连接 `http://127.0.0.1:11434/v1`、使用 `qwen2.5:7b`；不需要 `AI_API_KEY`，请求也不会携带密钥。

### 方式二：智谱 GLM-4-Flash（免费额度，需要密钥）

```powershell
$env:AI_PROVIDER = 'zhipu'
$env:AI_API_KEY = '你的智谱 API Key'
.\start-local.cmd
```

### 方式三：OpenRouter 免费模型（需要密钥）

```powershell
$env:AI_PROVIDER = 'openrouter'
$env:AI_API_KEY = 'sk-or-你的密钥'
.\start-local.cmd
```

默认模型为 `meta-llama/llama-3.3-70b-instruct:free`。

也可以继续使用 OpenAI 或其他兼容服务（付费）：

```powershell
$env:AI_API_KEY = 'sk-你的密钥'
$env:AI_BASE_URL = 'https://api.openai.com/v1'   # 可选，OpenAI 兼容地址
$env:AI_MODEL = 'gpt-5.4-mini'                    # 可选，统一指定模型
.\start-local.cmd
```

- `AI_PROVIDER` 可用：`ollama`、`zhipu`、`openrouter`（以上为免费方案）、`deepseek`、`moonshot`、`dashscope`、`openai`、`custom`。显式设置 `AI_BASE_URL` 时地址优先生效，`AI_MODEL` 可覆盖预设模型。
- 识别页会显示当前模型，如「免费模型 · 本地 Ollama · qwen2.5:7b」；未配置时显示「未配置 AI 识别」并改用本地规则。
- 支持范围：五个模块的「快速记录 / 快速录入」**文字输入**都会先调用 AI 识别；衣物、电子设备、会员订阅只支持文字描述。
- 项目根目录的 `.env` 会自动加载（已在环境变量里的值优先），所以也可以把 `AI_PROVIDER`、`AI_API_KEY`、`OPENAI_API_KEY` 等写进 `.env`；DeepSeek 等已知兼容地址在未设置 `AI_MODEL` 时会自动使用对应模型（如 `deepseek-chat`）。
- 照片和语音识别不属于本次范围：默认关闭，只有设置 `AI_MEDIA=1` 才会显示食品、药品的拍照 / 语音入口（保留的旧能力，未经实机验收）。
- 未配置密钥、网络异常、额度不足或模型返回异常时，自动回退本地规则，不会丢失已输入的描述；核对卡片会标明「AI 识别」或「文字规则提取」。
- 只填原文或标签明确给出的信息，日期不做推算；AI 结果只是草稿，全部字段核对后才会写入数据库。
- 密钥只存在于当前 PowerShell 进程，不会写入数据库、代码或页面；关闭窗口后需重新设置。
- OpenAI 官方地址默认走 Responses API；换成其他 OpenAI 兼容服务时默认走 Chat Completions 的 JSON 模式，也可用 `AI_API_MODE=responses|chat` 强制指定。旧变量 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_FOOD_MODEL`、`OPENAI_DRUG_MODEL` 仍可用，`AI_*` 优先。
- 衣物、电子设备、会员订阅可用 `OPENAI_CLOTHING_MODEL`、`OPENAI_DEVICE_MODEL`、`OPENAI_SUBSCRIPTION_MODEL` 单独指定模型；语音转写用 `OPENAI_TRANSCRIBE_MODEL` 或 `AI_TRANSCRIBE_MODEL`。
- 本次接入只用本地模拟接口验证了文字识别的识别与回退逻辑；真实模型仍需各成员用真实账号在实机验收，验收前不要标记为已完成。

## 本机账号（注册与登录）

本地版默认开启登录：第一次启动打开 http://127.0.0.1:8080/ 会先进入注册页，创建第一个本机账号后即可进入；之后未登录会跳转到登录页。账号、密码（Argon2id 哈希）和会话只保存在本机数据库，不上传任何地方。

- 账号只用于确认“是谁在用这台电脑”，**同一台电脑上的所有账号共用同一份数据**，不做数据隔离；这样升级到本版本不会丢失原有记录。云端演示站仍按账号隔离数据。
- 登录后每个页面顶部会出现**账户栏**：左侧是用户名首字母头像、用户名与注册时间，右侧是「个人信息」（打开 `/account`）和「退出登录」。`/account` 页同时列出用户名、注册时间、数据位置，并可修改密码。
- 打开左上角「菜单」，「我的账号」在导航列表最后：可修改密码或退出登录；修改密码会让其他已登录会话失效。会话有效期 7 天，Cookie 为本机专用 `lifecycle_local`（HttpOnly、SameSite=Lax；本机用 http 访问，因此不加 Secure）。
- 注册用户名 3–32 个字符，可用英文字母、数字、点、短横线、下划线，且不能与已有账号重复；密码至少 8 位，并需同时包含大写字母、小写字母和数字。登录页与登录后的界面共用同一套蓝紫粉色调：登录/注册页保留纸张卡片与衬线标题的生活化排版，配色与应用内页面一致，规则以提示标签显示在输入框下方。没有邮箱找回流程，忘记密码时可再注册一个账号继续使用（数据共享），或先备份数据目录后清理数据库中的 LocalAccount 表。
- 不想登录时可临时关闭：在 `.env` 写 `LOCAL_ACCOUNTS=off` 并重启，即可恢复为旧的无账号模式；删掉该行并重启会重新要求登录。

## 已有组员更新到最新 main

原有 Windows 本地启动方式保持不变，不需要迁移到云端。升级后第一次启动会要求创建一个本机账号（同一台电脑上的账号仍共用原有数据）；不想登录时可先在 `.env` 写 `LOCAL_ACCOUNTS=off` 再启动。

1. 先在原启动窗口按 Ctrl+C，等待进程结束，再备份自己的 `%LOCALAPPDATA%\LifeCycleHub-Team` 目录。
2. Git 用户在项目工作区干净时执行：

```powershell
git status --short
git switch main
git pull --ff-only origin main
.\start-local.cmd
```

出现未提交修改或无法快进时停止，请负责人协助；不要 reset、force push 或删除数据。ZIP 用户可将新版本解压到新目录，再双击 `start-local.cmd`；默认数据在用户目录中，换代码目录不应丢失数据。自定义过 `LIFECYCLE_TEAM_DATA_DIR` 的用户应继续使用原绝对路径。

启动时自动应用尚未执行的迁移，包括设备 `0014`、订阅 `0015` 和本机账号 `0016`；旧数据库迁移前自动生成 `.before-migration-时间戳.sqlite` 快照。不要复制组员的数据库，或把个人版数据库指向团队环境。发生迁移错误保留原库、快照与错误信息，不删除重建。回退旧代码不等于回退数据库。

新版本包含设备购买/保修/维护、订阅状态/日期提醒，以及五模块文字规则录入与统一取消按钮。更新后须重启原服务，重复点击启动脚本只复用服务，不热更新正在运行的代码。

本地服务只监听本机。每位组员在自己的电脑上打开启动窗口显示的地址；`127.0.0.1` 不会访问负责人电脑，设备之间也不会自动同步数据。

## 关闭、重启与恢复

关闭浏览器后服务仍运行。停止请在启动窗口按 Ctrl+C。电脑关机后，下次开机重新双击 `start-local.cmd`，本项目不配置开机自启动。团队版目前没有独立停止脚本。

恢复备份前先停止服务并另存当前目录，优先在新测试目录恢复。设置 `LIFECYCLE_TEAM_DATA_DIR` 为该目录后启动，检查食品、药品、设备、订阅和维护记录，再决定是否用于日常使用。不要覆盖正在运行的 SQLite 文件。

## 数据与备份

- 数据库：%LOCALAPPDATA%\LifeCycleHub-Team\data\team.sqlite。
- 文件目录：%LOCALAPPDATA%\LifeCycleHub-Team\uploads。此目录已预留并自动创建。
  当前本地版未提供附件上传管理。在线 AI 识别属于可选集成，未配置密钥时本地运行不受影响。
- 备份：先停止服务，再把整个 LifeCycleHub-Team 数据目录复制到个人备份位置。
  恢复前先备份当前目录，在服务停止时使用自己的备份。更新代码时保留用户数据目录。
- 测试人员可在 PowerShell 设置 LIFECYCLE_TEAM_DATA_DIR 指向新的空目录来试用独立测试库。
  第一次打开同样要先注册一个本机账号，账号和测试数据都只保存在该目录；项目文件夹、个人版数据目录和测试目录请分别保留，不要把任何数据目录提交到 GitHub。

## 常见问题

- 地址打不开：保持启动窗口运行，使用窗口显示的地址。双击启动脚本会复用已在运行的团队服务。
- 8080 已占用：启动器会尝试 8081。两个端口都占用时，可在 PowerShell 设置
  $env:PORT='8090'，再运行 .\start-local.cmd。
- 提示找不到 Node：运行 node -v，确认终端可见 Node.js 24，再重新打开脚本。
- 数据库启动失败：检查报错和用户目录写权限；保留原文件及备份，可用单独测试目录重试。
  如需请组员协助，只共享错误信息，不发送个人数据库。

## 开发与协作

main 为稳定分支。每项任务使用功能分支，测试通过后发起 Pull Request。
运行 node build.mjs 构建，运行 npm test 执行冒烟和权限回归。
完整分步检查如下（测试使用隔离数据库，不使用组员的日常库）：

```powershell
node build.mjs --test-legacy
node --test smoke.test.mjs home-ui.test.mjs browser-filter.test.mjs device.test.mjs subscription.test.mjs entry-ui.test.mjs date-picker-only.test.mjs home-colors.test.mjs quick-ai.test.mjs free-ai.test.mjs expiry-intake.test.mjs local-auth.test.mjs env-file.test.mjs
```

`node start-team.mjs --no-browser` 可验证启动而不自动弹出浏览器，仍需手动打开输出的地址。最近在 Windows 临时目录验证了启动器、五模块 HTTP 访问、重复启动复用、写入后结束测试进程并重启的数据保留；真实 Windows 重启和浏览器视觉验收仍需各成员实际确认。

## 课堂演示操作

1. 打开「食品」→「快速记录」，输入「刚才买了两桶方便面，放在柜子里了」。核对名称、2 桶和厨房储物柜，再确认保存。
2. 在食品批次详情修改数量或记录消耗，刷新确认已保存。再退出服务并重新启动，确认记录仍在。
3. 到「药品」新建虚构档案和批次，登记一次实际服用，检查库存扣减及服用历史。
4. 衣物、电子设备和会员订阅可分别新建、编辑或删除虚构档案。

如需演练而不影响日常库存，先关闭正在运行的团队版，然后在 PowerShell 中执行：

```powershell
$env:LIFECYCLE_TEAM_DATA_DIR = Join-Path $env:LOCALAPPDATA 'LifeCycleHub-Team-Test'
$env:PORT = '8090'
.\start-local.cmd
```

打开 http://127.0.0.1:8090/，第一次先注册一个测试账号；测试库会自动初始化。关闭该 PowerShell 后，常规启动仍使用默认目录。

## 测试账号汇总

| 环境 | 测试身份 | 使用方法 |
|---|---|---|
| 团队本地 Web | 首个本机账号（首次启动时注册） | 每位组员直接启动。第一次打开先注册；账号只确认身份，同机所有账号共用本机数据。可用 `LOCAL_ACCOUNTS=off` 临时关闭登录。 |
| 独立测试库 | 该测试库首次注册的本机账号 | 使用上面的测试目录和独立端口；第一次打开先注册，账号与测试数据只存于该目录，可验证初始化、写入、重启和恢复。 |
| 线上课程演示站 | course_test_a / course_test_b | 这是预留的验收用户名。首次使用由负责人私下提供各自的一次性邀请码，测试人员自行设置密码。若尚未开户，用户名无法直接登录。 |
| 自动化回归 | course-check / visitor-check，drug-smoke-a / drug-smoke-b | 测试脚本在内存 SQLite 中创建的虚构身份，供隔离测试使用。 |

两位线上测试人员可分别创建虚构食品批次，刷新页面确认自己的记录保留，再尝试打开另一位的批次链接，确认无法查看。线上入口受托管平台网络可用性影响，课堂首选团队本地版。个人站账号不用于团队验收。

## 更多说明

- [团队贡献规范](CONTRIBUTING.md)
- [运行、验收与同步指南](docs/run-and-sync-guide.md)
- [生活化快速录入样本：五模块全部可录信息](docs/demo-samples.md)
- [云端部署（Cloudflare Workers + D1）](docs/cloud-deploy.md)
- [开发环境](docs/development-guide.md)
- [项目架构](docs/architecture.md)
- [数据库与恢复](docs/database-design.md)
- [测试与验收](docs/testing-guide.md)
- [版本更新](CHANGELOG.md)
