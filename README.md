# Steam Workshop 代理

基于 **Hono** 构建的轻量级 Steam Workshop API 反向代理，专为国内应用（如 Mirage Wallpaper）提供稳定低延迟的 Steam 数据访问通道。

## 支持平台

| 平台 | 运行时 | 配置文件 |
|------|--------|---------|
| Cloudflare Workers | V8 Isolate | `wrangler.toml` |
| 腾讯 EdgeOne Edge Functions | V8 Isolate | `edgeone.json` |
| 阿里云 ESA Edge Routines | V8 Isolate | 同 Cloudflare 配置 |

## 快速开始

```bash
# 安装依赖
npm install

# 本地开发（Cloudflare）
npm run dev

# 部署到 Cloudflare Workers
npm run deploy:cf
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `STEAM_API_KEY` | Steam Web API Key | `C3CBFF169FCAC7F110689B8C6E6908E7` |
| `STEAM_APP_ID` | Steam App ID | `431960` (Wallpaper Engine) |

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 服务主页 |
| GET | `/health` | 健康检查 |
| GET | `/api/steam/query` | QueryFiles 代理 |
| POST | `/api/steam/details` | GetPublishedFileDetails 代理 |
| GET | `/api/steam/trending` | 热门内容 |
| GET | `/api/steam/recent` | 最新内容 |
| GET | `/api/steam/top` | 最高评分 |
| GET | `/api/steam/subscribed` | 最多订阅 |

## 安全说明

所有 `/api/*` 路由均内置地域检测，海外 IP 返回 HTTP **451** 状态码。
