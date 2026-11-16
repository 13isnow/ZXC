# ZXC 模型检测网站

此仓库只发布 `frontend/` 页面文件。模型、推理后端和研究数据仍保留在模型运行的本机。

## 启用 GitHub Pages

在仓库 Settings → Pages → Build and deployment 中选择 GitHub Actions。推送到 `main` 后会自动发布到：

`https://13isnow.github.io/ZXC/`

## 连接本机模型服务

本机启动模型 API，再使用 Cloudflare Tunnel 将本地 `http://127.0.0.1:4173` 映射为 HTTPS 地址。模型进程和 tunnel 需要保持运行。

在 Settings → Secrets and variables → Actions → Variables 中添加仓库变量 `AIGC_API_BASE_URL`，值为 tunnel 的 HTTPS 根地址，例如 `https://model.example.com`，不要附加 `/api`。之后重新运行 Deploy website to GitHub Pages 工作流。此变量会写入公开网页的 `config.js`，因此只能填公开 API 地址，不能填令牌或密钥。

仓库变量留空时，页面仍可访问，但不能连接模型。后端须将 `AIGC_ALLOWED_ORIGINS` 设置为 `https://13isnow.github.io`，以允许 Pages 调用推理 API。
