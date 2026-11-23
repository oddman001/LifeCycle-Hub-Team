# 开发指南

安装 Git 和 Node.js 24 LTS。确认 `node -v` 和 `npm -v` 能运行。在 Windows PowerShell 中执行：

```powershell
git clone https://github.com/CanyangChen/LifeCycle-Hub-Team.git
Set-Location LifeCycle-Hub-Team
npm ci --ignore-scripts
.\start-local.cmd
```

启动脚本会构建项目。按窗口提示打开 8080 或 8081 的本地网址，按 Ctrl+C 停止。项目没有第三方运行依赖，下载 ZIP 后也可直接启动。首次打开生成团队测试样例。

用 `$env:PORT = '8090'` 指定其他端口。要使用独立测试库，启动前把 `LIFECYCLE_TEAM_DATA_DIR` 设为个人测试路径。变量只作用于当前终端及其子进程；配置示例见 `.env.example`。

快速记录的 AI 识别同样通过环境变量开启：`AI_API_KEY` 必填，`AI_BASE_URL`、`AI_MODEL`、`AI_API_MODE` 可选；不配置时保持本地文字规则。识别范围是文字输入，照片与语音默认关闭（`AI_MEDIA=1` 才开启）。AI 识别与回退的自动化回归在 `quick-ai.test.mjs`，使用模拟接口，不访问真实模型。

更新代码前确认所在分支和仓库地址。以最新 `main` 创建功能或修复分支，完成后走 [PR 流程](../CONTRIBUTING.md)。
