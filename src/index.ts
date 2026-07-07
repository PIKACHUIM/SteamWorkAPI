import { Hono } from 'hono'
import { cors } from 'hono/cors'

// ── Environment bindings (Cloudflare Workers / EdgeOne / ESA) ──────────────
export interface Env {
  STEAM_API_KEY?: string
  STEAM_APP_ID?: string
}

// ── Constants ─────────────────────────────────────────────────────────────
const DEFAULT_API_KEY = 'C3CBFF169FCAC7F110689B8C6E6908E7'
const DEFAULT_APP_ID  = '431960'
const STEAM_BASE      = 'https://api.steampowered.com'

// ── Helpers ───────────────────────────────────────────────────────────────

/** Base env fallback */
function getEnv(env: Env) {
  return {
    apiKey: env.STEAM_API_KEY || DEFAULT_API_KEY,
    appId:  env.STEAM_APP_ID  || DEFAULT_APP_ID,
  }
}

/**
 * Resolve apiKey / appId with priority:
 *   1. explicit query param  (?apiKey=…&appId=…)
 *   2. environment variable  (STEAM_API_KEY / STEAM_APP_ID)
 *   3. compiled-in defaults
 */
function resolveKeys(
  q: Record<string, string>,
  env: Env,
): { apiKey: string; appId: string } {
  const base = getEnv(env)
  return {
    apiKey: (q['apiKey'] ?? q['api_key'] ?? '').trim() || base.apiKey,
    appId:  (q['appId']  ?? q['app_id']  ?? '').trim() || base.appId,
  }
}

/**
 * Detect visitor country from multiple edge-runtime headers.
 * Priority: CF → EdgeOne → ESA → unknown
 */
function getCountry(req: Request): string {
  // Cloudflare Workers
  const cfReq = req as Request & { cf?: { country?: string } }
  if (cfReq.cf?.country) return cfReq.cf.country

  // Tencent EdgeOne / Alibaba ESA / generic CDN
  return (
    req.headers.get('X-Country-Code') ||
    req.headers.get('CF-IPCountry')   ||
    req.headers.get('X-Client-Country') ||
    req.headers.get('X-Geo-Country')  ||
    'unknown'
  )
}

function isAllowed(country: string): boolean {
  // 仅允许中国大陆，unknown 视为允许（本地开发 / CI）
  return country === 'CN' || country === 'unknown'
}

// ── 451 Page ──────────────────────────────────────────────────────────────
function blockedPage(country: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>451 访问受限</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;
  background:#0b1120;color:#f1f5f9;min-height:100vh;
  display:flex;align-items:center;justify-content:center;padding:2rem}
.card{background:rgba(255,255,255,0.04);border:1px solid rgba(248,113,113,0.25);
  border-radius:16px;padding:3rem 2.5rem;max-width:500px;text-align:center}
.icon{font-size:4rem;margin-bottom:1.5rem;filter:drop-shadow(0 0 20px rgba(248,113,113,0.4))}
h1{font-size:1.6rem;font-weight:700;color:#f87171;margin-bottom:.75rem}
p{color:#94a3b8;line-height:1.75;margin-bottom:.5rem}
.code{display:inline-block;background:rgba(248,113,113,0.12);
  color:#f87171;padding:.2rem .7rem;border-radius:6px;font-family:monospace;font-size:.9rem}
</style>
</head>
<body>
<div class="card">
  <div class="icon">🚫</div>
  <h1>访问受限 · 451</h1>
  <p>本服务仅供<strong style="color:#f1f5f9">中国大陆</strong>用户使用。</p>
  <p>检测到您的访问来自 <span class="code">${country}</span> 地区，依据相关规定无法为您提供服务。</p>
  <p style="margin-top:1.5rem;font-size:.85rem;color:#64748b">
    This service is restricted to Mainland China users only.<br>
    Unavailable for Legal Reasons · HTTP 451
  </p>
</div>
</body>
</html>`
}

// ── Homepage HTML ─────────────────────────────────────────────────────────
function homePage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Steam API 代理</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#070e1c;
  --surface:rgba(255,255,255,0.028);
  --surface-hover:rgba(255,255,255,0.05);
  --border:rgba(255,255,255,0.06);
  --border-hi:rgba(255,255,255,0.12);
  --text:#ecf0f4;
  --muted:#7d93ac;
  --faint:#3d5066;
  --sky:#38bdf8;
  --sky-dim:rgba(56,189,248,0.12);
  --sky-glow:rgba(56,189,248,0.22);
  --emerald:#34d399;
  --emerald-dim:rgba(52,211,153,0.12);
  --amber:#fbbf24;
  --amber-dim:rgba(251,191,36,0.12);
  --rose:#f87171;
  --violet:#a78bfa;
  --violet-dim:rgba(167,139,250,0.12);
  --heading:'Space Grotesk',sans-serif;
  --body:'DM Sans',sans-serif;
  --mono:'JetBrains Mono',monospace;
  --spring:cubic-bezier(0.34,1.56,0.64,1);
  --ease:cubic-bezier(0.32,0.72,0,1);
  --r:14px;
  --r-lg:20px;
}
html{scroll-behavior:smooth;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{
  font-family:var(--body);background:var(--bg);color:var(--text);
  min-height:100vh;overflow-x:hidden;line-height:1.6;
}
/* Ambient glow backdrop */
.ambient{
  position:fixed;inset:0;pointer-events:none;z-index:0;
  background:
    radial-gradient(ellipse 80% 40% at 10% -5%,rgba(56,189,248,.055) 0%,transparent 55%),
    radial-gradient(ellipse 60% 50% at 90% 95%,rgba(167,139,250,.04) 0%,transparent 55%);
}
/* Grain */
.ambient::after{
  content:'';position:fixed;inset:0;
  opacity:.022;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='250' height='250'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='250' height='250' filter='url(%23n)'/%3E%3C/svg%3E");
}
.wrap{max-width:880px;margin:0 auto;padding:0 1.5rem;position:relative;z-index:1}

/* ── NAV ── */
nav{position:sticky;top:1.2rem;z-index:50;display:flex;justify-content:center;padding:.5rem 0;pointer-events:none}
.nav-pill{
  pointer-events:all;
  display:flex;align-items:center;gap:.15rem;
  background:rgba(7,14,28,.8);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border:1px solid var(--border-hi);border-radius:99px;
  padding:.45rem .8rem;
  box-shadow:0 0 0 1px rgba(255,255,255,.03),0 8px 32px rgba(0,0,0,.5);
}
.nav-brand{
  font-family:var(--heading);font-size:.82rem;font-weight:700;
  color:var(--sky);padding:.3rem .75rem;margin-right:.3rem;letter-spacing:-.01em;
}
.nav-pill a{
  font-size:.8rem;font-weight:500;color:var(--muted);
  text-decoration:none;padding:.28rem .65rem;border-radius:99px;
  transition:color .2s var(--ease),background .2s var(--ease);
  white-space:nowrap;
}
.nav-pill a:hover{color:var(--text);background:rgba(255,255,255,.06)}

/* ── HERO ── */
.hero{padding:5.5rem 0 3rem;text-align:center}
.hero-badge{
  display:inline-flex;align-items:center;gap:.45rem;
  font-family:var(--mono);font-size:.7rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;
  color:var(--sky);
  background:var(--sky-dim);
  border:1px solid rgba(56,189,248,.18);
  padding:.32rem .85rem;border-radius:99px;margin-bottom:1.75rem;
}
.dot-pulse{
  width:6px;height:6px;border-radius:50%;background:var(--sky);
  animation:pulse 2s ease-in-out infinite;
}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}
h1{
  font-family:var(--heading);
  font-size:clamp(2rem,5.5vw,3.4rem);font-weight:700;line-height:1.1;letter-spacing:-.03em;
  margin-bottom:1.2rem;
}
.h1-line1{
  display:block;
  background:linear-gradient(180deg,#ffffff 30%,#c4d6e8 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
}
.h1-line2{
  display:block;
  background:linear-gradient(135deg,var(--sky) 0%,#818cf8 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
}
.hero-desc{color:var(--muted);font-size:1rem;max-width:520px;margin:0 auto 2.5rem;line-height:1.8}

/* ── DEPLOY BUTTONS ── */
.btns{display:flex;justify-content:center;flex-wrap:wrap;gap:.65rem}
.btn{
  display:inline-flex;align-items:center;gap:.6rem;
  font-family:var(--body);font-size:.855rem;font-weight:600;
  padding:.6rem 1.25rem;border-radius:99px;text-decoration:none;
  transition:all .35s var(--ease);
  white-space:nowrap;
}
.btn-pri{
  background:var(--sky);color:#04111f;
  box-shadow:0 1px 0 rgba(255,255,255,.25) inset,0 6px 20px var(--sky-glow);
}
.btn-pri:hover{filter:brightness(1.1);transform:translateY(-2px);box-shadow:0 1px 0 rgba(255,255,255,.25) inset,0 10px 28px var(--sky-glow)}
.btn-ghost{
  background:var(--surface);color:var(--text);
  border:1px solid var(--border-hi);
  box-shadow:0 1px 0 rgba(255,255,255,.04) inset;
}
.btn-ghost:hover{background:var(--surface-hover);border-color:rgba(255,255,255,.2);transform:translateY(-2px)}
.btn-ico{
  width:20px;height:20px;border-radius:50%;
  background:rgba(0,0,0,.15);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}

/* ── SECTION HEADER ── */
.sec-hd{
  display:flex;align-items:center;gap:.8rem;
  font-family:var(--mono);font-size:.68rem;font-weight:500;letter-spacing:.12em;text-transform:uppercase;
  color:var(--faint);margin-bottom:1.5rem;
}
.sec-hd::after{content:'';flex:1;height:1px;background:var(--border)}
.section{margin:3.5rem 0}

/* ── FEATURE CARDS ── */
.feat-grid{display:grid;grid-template-columns:1fr 1fr;gap:.875rem}
@media(max-width:640px){.feat-grid{grid-template-columns:1fr}}
.feat-card{
  position:relative;overflow:hidden;
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:var(--r-lg);
  padding:1.5rem;
  transition:border-color .3s var(--ease),transform .4s var(--ease),box-shadow .4s var(--ease);
}
.feat-card:hover{
  border-color:var(--border-hi);
  transform:translateY(-3px);
  box-shadow:0 12px 40px rgba(0,0,0,.4);
}
/* accent glow strip per card */
.feat-card::before{
  content:'';position:absolute;left:0;top:0;bottom:0;width:3px;
  border-radius:99px 0 0 99px;
  background:var(--strip,var(--sky));
  opacity:.8;
}
.feat-card.sky{--strip:var(--sky)}
.feat-card.em{--strip:var(--emerald)}
.feat-card.am{--strip:var(--amber)}
.feat-card.vi{--strip:var(--violet)}
.feat-icon{
  width:36px;height:36px;border-radius:10px;
  display:flex;align-items:center;justify-content:center;
  margin-bottom:1rem;
  background:var(--icon-bg,var(--sky-dim));
  box-shadow:0 0 16px var(--icon-glow,transparent);
}
.feat-card.sky .feat-icon{--icon-bg:var(--sky-dim);--icon-glow:rgba(56,189,248,.15)}
.feat-card.em  .feat-icon{--icon-bg:var(--emerald-dim);--icon-glow:rgba(52,211,153,.15)}
.feat-card.am  .feat-icon{--icon-bg:var(--amber-dim);--icon-glow:rgba(251,191,36,.15)}
.feat-card.vi  .feat-icon{--icon-bg:var(--violet-dim);--icon-glow:rgba(167,139,250,.15)}
.feat-icon svg{width:18px;height:18px}
.feat-card.sky .feat-icon svg{color:var(--sky)}
.feat-card.em  .feat-icon svg{color:var(--emerald)}
.feat-card.am  .feat-icon svg{color:var(--amber)}
.feat-card.vi  .feat-icon svg{color:var(--violet)}
.feat-title{font-family:var(--heading);font-size:.97rem;font-weight:600;margin-bottom:.4rem;letter-spacing:-.01em}
.feat-body{color:var(--muted);font-size:.86rem;line-height:1.65}
.feat-tag{
  display:inline-flex;align-items:center;
  font-family:var(--mono);font-size:.68rem;font-weight:500;
  background:rgba(255,255,255,.06);border:1px solid var(--border-hi);
  color:var(--sky);padding:.15rem .5rem;border-radius:5px;
  margin:0 .15rem;vertical-align:middle;
}
</style>
</head>
<body>
<div class="ambient"></div>
<div class="wrap">

<!-- NAV -->
<nav>
  <div class="nav-pill">
    <span class="nav-brand">⚡ Steam Proxy</span>
    <a href="#features">特性</a>
    <a href="#api">API</a>
    <a href="#usage">示例</a>
    <a href="#env">配置</a>
  </div>
</nav>

<!-- HERO -->
<section class="hero reveal">
  <div class="hero-badge"><div class="dot-pulse"></div>Edge Runtime · Hono Framework</div>
  <h1>
    <span class="h1-line1">Steam API 加速代理</span>
  </h1>
  <p class="hero-desc">基于 Hono，支持 Cloudflare Workers、EdgeOne、Aliyun ESA 部署</p>
  <p class="hero-desc">为国内应用提供稳定低延迟的 Steam Workshop API 访问通道。</p>
  <div class="btns">
    <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/yourusername/steam-workshop-proxy"
       class="btn btn-pri" target="_blank" rel="noopener">
      <span class="btn-ico"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 2v9M4 7l4 4 4-4"/><path d="M2 14h12"/></svg></span>
      部署到 Cloudflare
    </a>
    <a href="https://console.cloud.tencent.com/edgeone/edge-functions" class="btn btn-ghost" target="_blank" rel="noopener">
      <span class="btn-ico"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 2v9M4 7l4 4 4-4"/><path d="M2 14h12"/></svg></span>
      腾讯 EdgeOne
    </a>
    <a href="https://esa.console.aliyun.com/" class="btn btn-ghost" target="_blank" rel="noopener">
      <span class="btn-ico"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 2v9M4 7l4 4 4-4"/><path d="M2 14h12"/></svg></span>
      阿里云 ESA
    </a>
  </div>
</section>

<!-- FEATURES -->
<section class="section" id="features">
  <p class="sec-hd">功能特性</p>
  <div class="feat-grid">

    <div class="feat-card sky reveal">
      <div class="feat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>
      </div>
      <div class="feat-title">三平台一键部署</div>
      <div class="feat-body">同一份代码无缝运行于 Cloudflare Workers、腾讯 EdgeOne 与阿里云 ESA，标准 V8 Isolate 运行时，零冷启动延迟。</div>
    </div>

    <div class="feat-card em reveal" style="transition-delay:.06s">
      <div class="feat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <div class="feat-title">仅限中国大陆访问</div>
      <div class="feat-body">内置 IP 地域检测中间件，海外访问自动返回 HTTP <strong style="color:var(--rose)">451</strong>，合规运营无后顾之忧。</div>
    </div>

    <div class="feat-card am reveal" style="transition-delay:.10s">
      <div class="feat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
      <div class="feat-title">边缘低延迟</div>
      <div class="feat-body">通过就近边缘节点代理，规避国内直连 Steam API 超时，P99 响应时间大幅降低。</div>
    </div>

    <div class="feat-card vi reveal" style="transition-delay:.14s">
      <div class="feat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
        </svg>
      </div>
      <div class="feat-title">零代码配置</div>
      <div class="feat-body">API Key 与 App ID 通过环境变量注入，内置合理默认值。Fork 后直接部署，支持 <span class="feat-tag">STEAM_API_KEY</span> <span class="feat-tag">STEAM_APP_ID</span> 覆盖。</div>
    </div>

  </div>
</section>

<!-- API SECTION -->
<style>
/* ── API LIST ── */
.api-list{display:flex;flex-direction:column;gap:.55rem}
.api-row{
  display:flex;align-items:flex-start;gap:.9rem;
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--r);padding:1rem 1.2rem;
  transition:border-color .25s var(--ease),background .25s var(--ease),transform .3s var(--ease);
  cursor:default;
}
.api-row:hover{background:var(--surface-hover);border-color:var(--border-hi);transform:translateX(3px)}
.method{
  font-family:var(--mono);font-size:.68rem;font-weight:600;letter-spacing:.06em;
  padding:.28rem .65rem;border-radius:6px;flex-shrink:0;margin-top:.18rem;
  min-width:46px;text-align:center;
}
.m-get{background:var(--emerald-dim);color:var(--emerald);border:1px solid rgba(52,211,153,.2)}
.m-post{background:var(--amber-dim);color:var(--amber);border:1px solid rgba(251,191,36,.2)}
.api-info{min-width:0;flex:1}
.api-path{
  font-family:var(--mono);font-size:.84rem;color:var(--sky);
  margin-bottom:.25rem;display:flex;align-items:center;flex-wrap:wrap;gap:.4rem;
}
.api-desc{color:var(--muted);font-size:.84rem;line-height:1.6}
.api-desc code{
  font-family:var(--mono);font-size:.78rem;
  background:rgba(56,189,248,.09);color:var(--sky);
  padding:.1rem .38rem;border-radius:4px;
}
/* ── CODE BLOCK ── */
.code-wrap{
  background:rgba(0,0,0,.45);border:1px solid var(--border);
  border-radius:var(--r);overflow:hidden;
}
.code-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:.65rem 1.1rem;border-bottom:1px solid var(--border);
  background:rgba(0,0,0,.2);
}
.code-dots{display:flex;gap:.4rem}
.code-dots span{
  width:10px;height:10px;border-radius:50%;
  background:var(--c,rgba(255,255,255,.12));
}
.code-dots span:nth-child(1){--c:#ff5f57}
.code-dots span:nth-child(2){--c:#febc2e}
.code-dots span:nth-child(3){--c:#28c840}
.code-lang{font-family:var(--mono);font-size:.7rem;color:var(--faint);letter-spacing:.06em}
pre{
  padding:1.2rem 1.4rem;overflow-x:auto;
  font-family:var(--mono);font-size:.8rem;line-height:1.8;
  color:#d4dfe9;tab-size:2;
}
pre .cmt{color:var(--faint)}
pre .kw{color:var(--sky)}
pre .fn{color:var(--emerald)}
pre .str{color:#fca5a5}
pre .num{color:var(--amber)}
/* ── ENV TABLE ── */
.env-card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--r-lg);overflow:hidden;
}
.env-table{width:100%;border-collapse:collapse;font-size:.86rem}
.env-table thead th{
  text-align:left;font-family:var(--mono);font-size:.68rem;
  letter-spacing:.1em;text-transform:uppercase;
  color:var(--faint);padding:.75rem 1.2rem;
  background:rgba(0,0,0,.2);border-bottom:1px solid var(--border);
}
.env-table tbody tr{transition:background .2s}
.env-table tbody tr:hover{background:rgba(255,255,255,.025)}
.env-table td{
  padding:.85rem 1.2rem;
  border-bottom:1px solid rgba(255,255,255,.035);
}
.env-table td:first-child{font-family:var(--mono);font-size:.8rem;color:var(--sky)}
.env-table td:nth-child(2){color:var(--muted)}
.env-table td:last-child{font-family:var(--mono);font-size:.78rem;color:var(--faint)}
.env-note{padding:1rem 1.2rem;font-size:.83rem;color:var(--muted);background:rgba(56,189,248,.04);border-top:1px solid var(--border)}
.env-note a{color:var(--sky);text-decoration:none}
.env-note a:hover{text-decoration:underline}
/* ── FOOTER ── */
footer{
  padding:2rem 0;margin-top:3rem;
  border-top:1px solid var(--border);
  display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;
}
footer .copy{color:var(--faint);font-size:.82rem}
footer a{color:var(--faint);text-decoration:none;transition:color .2s}
footer a:hover{color:var(--sky)}
.chips{display:flex;gap:.5rem;flex-wrap:wrap}
.chip{
  display:inline-flex;align-items:center;gap:.4rem;
  font-family:var(--mono);font-size:.7rem;
  padding:.22rem .65rem;border-radius:99px;
}
.chip-ok{background:var(--emerald-dim);color:var(--emerald);border:1px solid rgba(52,211,153,.2)}
.chip-info{background:var(--sky-dim);color:var(--sky);border:1px solid rgba(56,189,248,.2)}
/* ── SCROLL REVEAL ── */
.reveal{opacity:0;transform:translateY(16px);transition:opacity .65s var(--ease),transform .65s var(--ease)}
.reveal.in{opacity:1;transform:none}
</style>

<section class="section" id="api">
  <p class="sec-hd">API 端点</p>
  <div class="api-list">
    <div class="api-row reveal">
      <span class="method m-get">GET</span>
      <div class="api-info">
        <div class="api-path">/api/steam/query</div>
        <div class="api-desc">代理 <code>IPublishedFileService/QueryFiles/v1/</code>，支持 search_text、tags、sort_order、page、numperpage 等全量参数。</div>
      </div>
    </div>
    <div class="api-row reveal" style="transition-delay:.04s">
      <span class="method m-post">POST</span>
      <div class="api-info">
        <div class="api-path">/api/steam/details</div>
        <div class="api-desc">代理 <code>ISteamRemoteStorage/GetPublishedFileDetails/v1/</code>，Body 传 <code>{"ids":["123","456"]}</code> 批量获取文件详情。</div>
      </div>
    </div>
    <div class="api-row reveal" style="transition-delay:.07s">
      <span class="method m-get">GET</span>
      <div class="api-info">
        <div class="api-path">/api/steam/trending</div>
        <div class="api-desc">热门 Workshop 内容，支持 <code>?count=N</code>（默认 10）。</div>
      </div>
    </div>
    <div class="api-row reveal" style="transition-delay:.10s">
      <span class="method m-get">GET</span>
      <div class="api-info">
        <div class="api-path">/api/steam/recent &nbsp;·&nbsp; /api/steam/top &nbsp;·&nbsp; /api/steam/subscribed</div>
        <div class="api-desc">最新上传、最高评分、最多订阅内容，均支持 <code>?count=N</code>。</div>
      </div>
    </div>
    <div class="api-row reveal" style="transition-delay:.13s">
      <span class="method m-get">GET</span>
      <div class="api-info">
        <div class="api-path">/health</div>
        <div class="api-desc">健康检查，返回服务状态 JSON。</div>
      </div>
    </div>
  </div>
</section>

<!-- USAGE -->
<section class="section" id="usage">
  <p class="sec-hd">使用示例</p>
  <div class="code-wrap reveal">
    <div class="code-header">
      <div class="code-dots"><span></span><span></span><span></span></div>
      <span class="code-lang">TypeScript / JavaScript</span>
    </div>
    <pre><span class="cmt">// 1. 搜索 Workshop 内容（分页）</span>
<span class="kw">const</span> res = <span class="kw">await</span> <span class="fn">fetch</span>(<span class="str">'/api/steam/query?search_text=anime&page=1&numperpage=20'</span>);
<span class="kw">const</span> data = <span class="kw">await</span> res.<span class="fn">json</span>();

<span class="cmt">// 2. 批量获取文件详情</span>
<span class="kw">const</span> detail = <span class="kw">await</span> <span class="fn">fetch</span>(<span class="str">'/api/steam/details'</span>, {
  method: <span class="str">'POST'</span>,
  headers: { <span class="str">'Content-Type'</span>: <span class="str">'application/json'</span> },
  body: JSON.<span class="fn">stringify</span>({ ids: [<span class="str">'3012345678'</span>, <span class="str">'2987654321'</span>] }),
});

<span class="cmt">// 3. 获取热门内容（前 20 条）</span>
<span class="kw">const</span> trending = <span class="kw">await</span> <span class="fn">fetch</span>(<span class="str">'/api/steam/trending?count=20'</span>);

<span class="cmt">// 4. 按标签 + 排序查询</span>
<span class="kw">const</span> tagged = <span class="kw">await</span> <span class="fn">fetch</span>(<span class="str">'/api/steam/query?tags=Live+Wallpaper&sort_order=top_rated'</span>);</pre>
  </div>
</section>

<!-- ENV CONFIG -->
<section class="section" id="env">
  <p class="sec-hd">环境变量</p>
  <div class="env-card reveal">
    <table class="env-table">
      <thead>
        <tr><th>变量名</th><th>说明</th><th>默认值</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>STEAM_API_KEY</td>
          <td>Steam Web API 密钥</td>
          <td>C3CBFF169F…E7</td>
        </tr>
        <tr>
          <td>STEAM_APP_ID</td>
          <td>目标 Steam App ID（Mirage Wallpaper）</td>
          <td>431960</td>
        </tr>
      </tbody>
    </table>
    <div class="env-note">
      前往 <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener">steamcommunity.com/dev/apikey</a> 申请专属 Key，在平台控制台的 Variables / 环境变量处覆盖默认值即可，无需修改代码。
    </div>
  </div>
</section>

<!-- TEST PANEL -->
<section class="section" id="tester">
  <p class="sec-hd">API 测试</p>
  <style>
  .tester{
    background:var(--surface);border:1px solid var(--border);
    border-radius:var(--r-lg);overflow:hidden;
  }
  .tester-head{
    padding:1rem 1.4rem;border-bottom:1px solid var(--border);
    display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem;
    background:rgba(0,0,0,.18);
  }
  .tester-head-title{
    font-family:var(--heading);font-size:.92rem;font-weight:600;letter-spacing:-.01em;
    display:flex;align-items:center;gap:.6rem;
  }
  .tester-head-title svg{width:16px;height:16px;color:var(--sky)}
  .tester-body{padding:1.25rem 1.4rem;display:flex;flex-direction:column;gap:1rem}
  /* credential row */
  .cred-row{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
  @media(max-width:560px){.cred-row{grid-template-columns:1fr}}
  /* form elements */
  .fld{display:flex;flex-direction:column;gap:.35rem}
  .fld label{
    font-family:var(--mono);font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;
    color:var(--faint);
  }
  .fld input,.fld select,.fld textarea{
    font-family:var(--mono);font-size:.82rem;color:var(--text);
    background:rgba(0,0,0,.3);
    border:1px solid var(--border-hi);border-radius:8px;
    padding:.6rem .9rem;outline:none;width:100%;
    transition:border-color .2s var(--ease),box-shadow .2s var(--ease);
    appearance:none;-webkit-appearance:none;
  }
  .fld input:focus,.fld select:focus,.fld textarea:focus{
    border-color:var(--sky);
    box-shadow:0 0 0 3px rgba(56,189,248,.12);
  }
  .fld input::placeholder{color:var(--faint);font-size:.78rem}
  .fld select option{background:#0d1a2d}
  .fld textarea{resize:vertical;min-height:80px;line-height:1.5}
  /* params grid */
  .params-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
  @media(max-width:560px){.params-grid{grid-template-columns:1fr}}
  /* action row */
  .action-row{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}
  .send-btn{
    display:inline-flex;align-items:center;gap:.6rem;
    font-family:var(--body);font-size:.875rem;font-weight:600;
    background:var(--sky);color:#04111f;
    border:none;cursor:pointer;
    padding:.6rem 1.4rem;border-radius:99px;
    transition:all .3s var(--ease);
    box-shadow:0 4px 16px var(--sky-glow);
  }
  .send-btn:hover{filter:brightness(1.1);transform:translateY(-1px);box-shadow:0 6px 20px var(--sky-glow)}
  .send-btn:active{transform:scale(.97)}
  .send-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
  .send-btn svg{width:15px;height:15px;transition:transform .3s var(--ease)}
  .send-btn:hover svg{transform:translateX(2px)}
  .status-badge{
    font-family:var(--mono);font-size:.75rem;
    padding:.28rem .75rem;border-radius:99px;
    border:1px solid transparent;
    display:none;
  }
  .status-badge.show{display:inline-flex;align-items:center;gap:.4rem}
  .status-badge.ok{background:var(--emerald-dim);color:var(--emerald);border-color:rgba(52,211,153,.2)}
  .status-badge.err{background:rgba(248,113,113,.1);color:var(--rose);border-color:rgba(248,113,113,.2)}
  .status-badge.loading{background:var(--sky-dim);color:var(--sky);border-color:rgba(56,189,248,.2)}
  /* response viewer */
  .resp-wrap{display:none}
  .resp-wrap.show{display:block}
  .resp-header{
    padding:.65rem 1.1rem;
    background:rgba(0,0,0,.25);border:1px solid var(--border);
    border-bottom:none;border-radius:var(--r) var(--r) 0 0;
    display:flex;justify-content:space-between;align-items:center;
  }
  .resp-header span{font-family:var(--mono);font-size:.72rem;color:var(--faint);letter-spacing:.06em}
  .copy-btn{
    font-family:var(--mono);font-size:.7rem;color:var(--muted);
    background:rgba(255,255,255,.06);border:1px solid var(--border-hi);
    padding:.2rem .65rem;border-radius:5px;cursor:pointer;
    transition:color .2s,background .2s;
  }
  .copy-btn:hover{color:var(--text);background:rgba(255,255,255,.1)}
  pre#resp-pre{
    background:rgba(0,0,0,.45);border:1px solid var(--border);
    border-radius:0 0 var(--r) var(--r);
    padding:1.1rem 1.3rem;overflow-x:auto;
    font-family:var(--mono);font-size:.78rem;line-height:1.75;
    color:#d4dfe9;max-height:480px;overflow-y:auto;
    white-space:pre;
  }
  </style>
  <div class="tester reveal">
    <div class="tester-head">
      <span class="tester-head-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>
        在线测试
      </span>
      <span style="font-size:.82rem;color:var(--faint)">apiKey / appId 留空则使用服务端环境变量</span>
    </div>
    <div class="tester-body">

      <!-- Credentials -->
      <div class="cred-row">
        <div class="fld">
          <label>API Key <span style="color:var(--faint);text-transform:none;letter-spacing:0">（可选，覆盖环境变量）</span></label>
          <input id="t-apikey" type="text" placeholder="留空使用服务端默认" autocomplete="off" spellcheck="false">
        </div>
        <div class="fld">
          <label>App ID <span style="color:var(--faint);text-transform:none;letter-spacing:0">（可选，覆盖环境变量）</span></label>
          <input id="t-appid" type="text" placeholder="留空使用服务端默认（431960）" autocomplete="off">
        </div>
      </div>

      <!-- Endpoint -->
      <div class="fld">
        <label>端点</label>
        <select id="t-endpoint" onchange="onEndpointChange()">
          <option value="query">GET /api/steam/query — 搜索 Workshop 文件</option>
          <option value="trending">GET /api/steam/trending — 热门内容</option>
          <option value="recent">GET /api/steam/recent — 最新内容</option>
          <option value="top">GET /api/steam/top — 最高评分</option>
          <option value="subscribed">GET /api/steam/subscribed — 最多订阅</option>
          <option value="details">POST /api/steam/details — 批量获取文件详情</option>
          <option value="health">GET /health — 健康检查</option>
        </select>
      </div>

      <!-- Dynamic params -->
      <div id="t-params-query" class="params-grid t-params">
        <div class="fld"><label>search_text</label><input id="p-search_text" type="text" placeholder="搜索关键词（可选）"></div>
        <div class="fld"><label>tags</label><input id="p-tags" type="text" placeholder="逗号分隔，如 Live Wallpaper,Anime"></div>
        <div class="fld"><label>sort_order</label>
          <select id="p-sort_order">
            <option value="trending">trending（热门）</option>
            <option value="most_recent">most_recent（最新）</option>
            <option value="most_subscribed">most_subscribed（最多订阅）</option>
            <option value="top_rated">top_rated（最高评分）</option>
          </select>
        </div>
        <div class="fld"><label>page</label><input id="p-page" type="number" value="1" min="1"></div>
        <div class="fld"><label>numperpage</label><input id="p-numperpage" type="number" value="10" min="1" max="100"></div>
      </div>

      <div id="t-params-count" class="t-params" style="display:none">
        <div class="fld" style="max-width:180px"><label>count</label><input id="p-count" type="number" value="10" min="1" max="100"></div>
      </div>

      <div id="t-params-details" class="t-params" style="display:none">
        <div class="fld">
          <label>Workshop IDs <span style="color:var(--faint);text-transform:none;letter-spacing:0">（每行一个或逗号分隔）</span></label>
          <textarea id="p-ids" placeholder="3012345678&#10;2987654321"></textarea>
        </div>
      </div>

      <div id="t-params-none" class="t-params" style="display:none">
        <p style="color:var(--faint);font-size:.85rem">此端点无需参数，直接发送即可。</p>
      </div>

      <!-- Action -->
      <div class="action-row">
        <button class="send-btn" id="t-send" onclick="doTest()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          发送请求
        </button>
        <span class="status-badge" id="t-status"></span>
      </div>

      <!-- Response -->
      <div class="resp-wrap" id="t-resp">
        <div class="resp-header">
          <span id="t-resp-label">RESPONSE</span>
          <button class="copy-btn" onclick="copyResp()">复制</button>
        </div>
        <pre id="resp-pre"></pre>
      </div>

    </div><!-- /tester-body -->
  </div><!-- /tester -->
</section>

<!-- FOOTER -->
<footer>
  <span class="copy">Steam Workshop 代理 &nbsp;·&nbsp; 基于 <a href="https://hono.dev" target="_blank" rel="noopener">Hono v4</a> 构建 &nbsp;·&nbsp; <a href="https://github.com/PIKACHUIM/SteamWorkAPI" target="_blank" rel="noopener">GitHub</a></span>
  <div class="chips">
    <span class="chip chip-ok"><svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor"><circle cx="3" cy="3" r="3"/></svg> 服务正常</span>
    <span class="chip chip-info">仅限中国大陆</span>
  </div>
</footer>

</div><!-- /wrap -->

<script>
// ── Scroll reveal ──────────────────────────────────────────────────────
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
  })
}, { threshold: 0.1 })
document.querySelectorAll('.reveal').forEach(el => io.observe(el))

// ── Test panel ─────────────────────────────────────────────────────────
const ENDPOINT_GROUPS = {
  query:      'query',
  trending:   'count',
  recent:     'count',
  top:        'count',
  subscribed: 'count',
  details:    'details',
  health:     'none',
}

function onEndpointChange() {
  const ep = document.getElementById('t-endpoint').value
  document.querySelectorAll('.t-params').forEach(el => el.style.display = 'none')
  const group = ENDPOINT_GROUPS[ep] || 'none'
  const target = document.getElementById('t-params-' + group)
  if (target) target.style.display = group === 'params-grid' ? 'grid' : 'block'
  if (group === 'query') target.style.display = 'grid'
}
// init
onEndpointChange()

function syntaxHL(json) {
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
      let cls = 'num'
      if (/^"/.test(m)) cls = /:$/.test(m) ? 'kw' : 'str'
      else if (/true|false/.test(m)) cls = 'fn'
      else if (/null/.test(m)) cls = 'cmt'
      return '<span class="' + cls + '">' + m + '</span>'
    })
}

async function doTest() {
  const btn    = document.getElementById('t-send')
  const badge  = document.getElementById('t-status')
  const respWrap = document.getElementById('t-resp')
  const pre    = document.getElementById('resp-pre')
  const label  = document.getElementById('t-resp-label')

  const ep     = document.getElementById('t-endpoint').value
  const apiKey = document.getElementById('t-apikey').value.trim()
  const appId  = document.getElementById('t-appid').value.trim()

  btn.disabled = true
  badge.className = 'status-badge loading show'
  badge.textContent = '⏳ 请求中…'

  try {
    let url, fetchOpts = {}

    if (ep === 'details') {
      const rawIds = document.getElementById('p-ids').value
      const ids = rawIds.split(/[,\\n]+/).map(s => s.trim()).filter(Boolean)
      url = '/api/steam/details'
      const bodyObj = { ids }
      if (apiKey) bodyObj.apiKey = apiKey
      if (appId)  bodyObj.appId  = appId
      fetchOpts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
      }
    } else if (ep === 'health') {
      url = '/health'
    } else {
      const params = new URLSearchParams()
      if (apiKey) params.set('apiKey', apiKey)
      if (appId)  params.set('appId',  appId)

      if (ep === 'query') {
        const st = document.getElementById('p-search_text').value.trim()
        const tg = document.getElementById('p-tags').value.trim()
        const so = document.getElementById('p-sort_order').value
        const pg = document.getElementById('p-page').value
        const np = document.getElementById('p-numperpage').value
        if (st) params.set('search_text', st)
        if (tg) params.set('tags', tg)
        if (so) params.set('sort_order', so)
        if (pg) params.set('page', pg)
        if (np) params.set('numperpage', np)
        url = '/api/steam/query?' + params.toString()
      } else {
        const cnt = document.getElementById('p-count').value
        if (cnt) params.set('count', cnt)
        url = '/api/steam/' + ep + '?' + params.toString()
      }
    }

    const t0 = Date.now()
    const res = await fetch(url, fetchOpts)
    const elapsed = Date.now() - t0
    const text = await res.text()
    let display
    try { display = JSON.stringify(JSON.parse(text), null, 2) }
    catch { display = text }

    badge.className = 'status-badge ' + (res.ok ? 'ok' : 'err') + ' show'
    badge.textContent = res.status + ' ' + res.statusText + ' · ' + elapsed + 'ms'
    label.textContent = 'RESPONSE · ' + url.split('?')[0]
    pre.innerHTML = syntaxHL(display)
    respWrap.classList.add('show')
    pre.scrollTop = 0

  } catch (err) {
    badge.className = 'status-badge err show'
    badge.textContent = '✕ ' + err.message
  } finally {
    btn.disabled = false
  }
}

function copyResp() {
  const pre = document.getElementById('resp-pre')
  navigator.clipboard.writeText(pre.innerText).then(() => {
    const btn = document.querySelector('.copy-btn')
    const old = btn.textContent
    btn.textContent = '已复制 ✓'
    setTimeout(() => btn.textContent = old, 1500)
  })
}
</script>
</body>
</html>`
}
// ── Steam API helpers ─────────────────────────────────────────────────────

/** Forward a Steam API GET request, injecting key + appid */
async function steamGet(
  path: string,
  extraParams: Record<string, string>,
  apiKey: string,
  appId: string,
): Promise<Response> {
  const params: Record<string, string> = {
    key: apiKey,
    appid: appId,
    ...extraParams,
  }
  const qs = new URLSearchParams(params).toString()
  const url = `${STEAM_BASE}${path}?${qs}`
  return fetch(url, {
    headers: { 'User-Agent': 'SteamWorkshopProxy/1.0' },
  })
}

/** Forward a Steam API POST request (form-encoded body) */
async function steamPost(path: string, bodyStr: string): Promise<Response> {
  return fetch(`${STEAM_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'SteamWorkshopProxy/1.0',
    },
    body: bodyStr,
  })
}

/** Build a forwarded JSON response, attaching CORS headers */
function proxyResponse(upstream: Response): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=60',
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  })
}

// ── App ───────────────────────────────────────────────────────────────────
const app = new Hono<{ Bindings: Env }>()

// CORS preflight
app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }))

// ── Geo-block middleware (apply to /api/* routes) ─────────────────────────
app.use('/api/*', async (c, next) => {
  const country = getCountry(c.req.raw)
  if (!isAllowed(country)) {
    return c.html(blockedPage(country), 451)
  }
  return next()
})

// ── Homepage ──────────────────────────────────────────────────────────────
app.get('/', (c) => c.html(homePage()))

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'steam-workshop-proxy',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  }),
)

// ── /api/steam/query ──────────────────────────────────────────────────────
// Proxies: IPublishedFileService/QueryFiles/v1/
app.get('/api/steam/query', async (c) => {
  const { apiKey, appId } = resolveKeys(c.req.query(), c.env)
  const q = c.req.query()

  // Allowed passthrough params (whitelist to avoid key leakage)
  const allowed = [
    'search_text', 'query_type', 'page', 'numperpage',
    'return_tags', 'return_previews', 'return_metadata',
    'strip_description_bbcode', 'sort_order',
  ]
  const extra: Record<string, string> = {
    return_tags: 'true',
    return_previews: 'true',
    return_metadata: 'true',
    strip_description_bbcode: 'true',
  }

  for (const k of allowed) {
    if (q[k] !== undefined) extra[k] = q[k]
  }

  // Handle tag array params  requiredtags[0], requiredtags[1] …
  let tagIdx = 0
  for (const [k, v] of Object.entries(q)) {
    if (/^requiredtags\[\d+\]$/.test(k)) {
      extra[k] = v
      tagIdx++
    }
  }
  // Convenience: ?tags=tag1,tag2
  if (q['tags']) {
    q['tags'].split(',').forEach((t: string, i: number) => {
      extra[`requiredtags[${tagIdx + i}]`] = t.trim()
    })
  }
  // Convenience: ?sort_order=trending|most_recent|…
  if (q['sort_order']) {
    const sortMap: Record<string, string> = {
      trending: '1', most_recent: '2', most_subscribed: '3', top_rated: '16',
    }
    extra['query_type'] = sortMap[q['sort_order']] ?? q['sort_order']
  }

  try {
    const upstream = await steamGet(
      '/IPublishedFileService/QueryFiles/v1/',
      extra,
      apiKey,
      appId,
    )
    return proxyResponse(upstream)
  } catch (e) {
    return c.json({ error: 'upstream_error', message: String(e) }, 502)
  }
})

// ── /api/steam/details ────────────────────────────────────────────────────
// Proxies: ISteamRemoteStorage/GetPublishedFileDetails/v1/  (POST)
app.post('/api/steam/details', async (c) => {
  let ids: string[] = []
  let reqApiKey = ''
  let reqAppId  = ''
  try {
    const body = await c.req.json<{ ids: string[]; apiKey?: string; appId?: string; api_key?: string; app_id?: string }>()
    ids       = body.ids     ?? []
    reqApiKey = (body.apiKey ?? body.api_key ?? '').trim()
    reqAppId  = (body.appId  ?? body.app_id  ?? '').trim()
  } catch {
    return c.json({ error: 'invalid_body', message: 'Expected JSON body: {"ids":["...","..."]}' }, 400)
  }
  if (!ids.length) return c.json({ error: 'missing_ids' }, 400)

  // also check query string (allows GET-style override even on POST)
  const q = c.req.query()
  const { apiKey } = resolveKeys({ ...q, ...(reqApiKey ? { apiKey: reqApiKey } : {}), ...(reqAppId ? { appId: reqAppId } : {}) }, c.env)

  let bodyParams = `key=${encodeURIComponent(apiKey)}&itemcount=${ids.length}`
  ids.forEach((id, i) => { bodyParams += `&publishedfileids[${i}]=${id}` })

  try {
    const upstream = await steamPost(
      '/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
      bodyParams,
    )
    return proxyResponse(upstream)
  } catch (e) {
    return c.json({ error: 'upstream_error', message: String(e) }, 502)
  }
})

// ── /api/steam/trending ───────────────────────────────────────────────────
app.get('/api/steam/trending', async (c) => {
  const { apiKey, appId } = resolveKeys(c.req.query(), c.env)
  const count = c.req.query('count') ?? '10'
  try {
    const upstream = await steamGet(
      '/IPublishedFileService/QueryFiles/v1/',
      { query_type: '1', page: '1', numperpage: count,
        return_tags: 'true', return_previews: 'true', return_metadata: 'true',
        strip_description_bbcode: 'true' },
      apiKey, appId,
    )
    return proxyResponse(upstream)
  } catch (e) {
    return c.json({ error: 'upstream_error', message: String(e) }, 502)
  }
})

// ── /api/steam/recent ─────────────────────────────────────────────────────
app.get('/api/steam/recent', async (c) => {
  const { apiKey, appId } = resolveKeys(c.req.query(), c.env)
  const count = c.req.query('count') ?? '10'
  try {
    const upstream = await steamGet(
      '/IPublishedFileService/QueryFiles/v1/',
      { query_type: '2', page: '1', numperpage: count,
        return_tags: 'true', return_previews: 'true', return_metadata: 'true',
        strip_description_bbcode: 'true' },
      apiKey, appId,
    )
    return proxyResponse(upstream)
  } catch (e) {
    return c.json({ error: 'upstream_error', message: String(e) }, 502)
  }
})

// ── /api/steam/top ────────────────────────────────────────────────────────
app.get('/api/steam/top', async (c) => {
  const { apiKey, appId } = resolveKeys(c.req.query(), c.env)
  const count = c.req.query('count') ?? '10'
  try {
    const upstream = await steamGet(
      '/IPublishedFileService/QueryFiles/v1/',
      { query_type: '16', page: '1', numperpage: count,
        return_tags: 'true', return_previews: 'true', return_metadata: 'true',
        strip_description_bbcode: 'true' },
      apiKey, appId,
    )
    return proxyResponse(upstream)
  } catch (e) {
    return c.json({ error: 'upstream_error', message: String(e) }, 502)
  }
})

// ── /api/steam/subscribed ────────────────────────────────────────────────
app.get('/api/steam/subscribed', async (c) => {
  const { apiKey, appId } = resolveKeys(c.req.query(), c.env)
  const count = c.req.query('count') ?? '10'
  try {
    const upstream = await steamGet(
      '/IPublishedFileService/QueryFiles/v1/',
      { query_type: '3', page: '1', numperpage: count,
        return_tags: 'true', return_previews: 'true', return_metadata: 'true',
        strip_description_bbcode: 'true' },
      apiKey, appId,
    )
    return proxyResponse(upstream)
  } catch (e) {
    return c.json({ error: 'upstream_error', message: String(e) }, 502)
  }
})

// ── /ISteamRemoteStorage/GetPublishedFileDetails/v1/ ─────────────────────
// 透明中继路由：供 Swift / 原生客户端直接以 Steam API 路径调用代理。
// 客户端只需把 base URL 从 api.steampowered.com 换成代理域名，无需改任何其他代码。
// 客户端可以不携带 key，代理自动从环境变量注入；若客户端已带 key 则保留原值。
app.post('/ISteamRemoteStorage/GetPublishedFileDetails/v1/', async (c) => {
  const { apiKey } = resolveKeys(c.req.query(), c.env)

  // 读取客户端发来的 form-encoded body
  // 例：itemcount=2&publishedfileids[0]=123&publishedfileids[1]=456
  let clientBody: string
  try {
    clientBody = await c.req.text()
  } catch {
    return c.json({ error: 'invalid_body', message: 'Cannot read request body' }, 400)
  }

  // 解析 body，检查客户端是否已携带 key；没有则注入代理的 key
  const parsed = new URLSearchParams(clientBody)
  if (!parsed.has('key')) {
    parsed.set('key', apiKey)
  }

  try {
    const upstream = await steamPost(
      '/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
      parsed.toString(),
    )
    return proxyResponse(upstream)
  } catch (e) {
    return c.json({ error: 'upstream_error', message: String(e) }, 502)
  }
})

// ── Export ────────────────────────────────────────────────────────────────
export default app
