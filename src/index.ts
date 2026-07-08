import { Hono } from 'hono'
import { cors } from 'hono/cors'

// ── Environment bindings ───────────────────────────────────────────────────
export interface Env {
  STEAM_API_KEY?: string
  STEAM_APP_ID?:  string
  STEAM_BASE?:    string   // upstream base URL, default https://api.steampowered.com
  ALLOW_AREA?:    string   // e.g. "CN" to restrict to mainland China only; empty = allow all
}

// ── Constants ──────────────────────────────────────────────────────────────
const DEFAULT_API_KEY = 'C3CBFF169FCAC7F110689B8C6E6908E7'
const DEFAULT_APP_ID  = '431960'
const DEFAULT_STEAM_BASE = 'https://api.steampowered.com'

// ── Helpers ────────────────────────────────────────────────────────────────
function getEnv(env: Env) {
  return {
    apiKey:     env.STEAM_API_KEY || DEFAULT_API_KEY,
    appId:      env.STEAM_APP_ID  || DEFAULT_APP_ID,
    steamBase:  (env.STEAM_BASE   || DEFAULT_STEAM_BASE).replace(/\/$/, ''),
    allowArea:  (env.ALLOW_AREA   || '').trim().toUpperCase(),  // '' = allow all
  }
}

function getCountry(req: Request): string {
  const cfReq = req as Request & { cf?: { country?: string } }
  if (cfReq.cf?.country) return cfReq.cf.country
  return (
    req.headers.get('X-Country-Code') ||
    req.headers.get('CF-IPCountry')   ||
    req.headers.get('X-Client-Country') ||
    req.headers.get('X-Geo-Country')  ||
    'unknown'
  )
}

function isAllowed(country: string, allowArea: string): boolean {
  if (!allowArea) return true                     // no restriction configured
  if (country === 'unknown') return true          // local dev / CI, always pass
  return country === allowArea
}


// ── 451 Page ───────────────────────────────────────────────────────────────
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

// ── Homepage HTML ──────────────────────────────────────────────────────────
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
  --bg:#070e1c;--surface:rgba(255,255,255,0.028);--surface-hover:rgba(255,255,255,0.05);
  --border:rgba(255,255,255,0.06);--border-hi:rgba(255,255,255,0.12);
  --text:#ecf0f4;--muted:#7d93ac;--faint:#3d5066;
  --sky:#38bdf8;--sky-dim:rgba(56,189,248,0.12);--sky-glow:rgba(56,189,248,0.22);
  --emerald:#34d399;--emerald-dim:rgba(52,211,153,0.12);
  --amber:#fbbf24;--amber-dim:rgba(251,191,36,0.12);
  --rose:#f87171;--violet:#a78bfa;--violet-dim:rgba(167,139,250,0.12);
  --heading:'Space Grotesk',sans-serif;--body:'DM Sans',sans-serif;--mono:'JetBrains Mono',monospace;
  --spring:cubic-bezier(0.34,1.56,0.64,1);--ease:cubic-bezier(0.32,0.72,0,1);
  --r:14px;--r-lg:20px;
}
html{scroll-behavior:smooth;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{font-family:var(--body);background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden;line-height:1.6}
.ambient{position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(ellipse 80% 40% at 10% -5%,rgba(56,189,248,.055) 0%,transparent 55%),
  radial-gradient(ellipse 60% 50% at 90% 95%,rgba(167,139,250,.04) 0%,transparent 55%)}
.ambient::after{content:'';position:fixed;inset:0;opacity:.022;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='250' height='250'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='250' height='250' filter='url(%23n)'/%3E%3C/svg%3E")}
.wrap{max-width:900px;margin:0 auto;padding:0 1.5rem;position:relative;z-index:1}

/* NAV */
nav{position:sticky;top:1.2rem;z-index:50;display:flex;justify-content:center;padding:.5rem 0;pointer-events:none}
.nav-pill{pointer-events:all;display:flex;align-items:center;gap:.1rem;
  background:rgba(7,14,28,.85);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border:1px solid var(--border-hi);border-radius:99px;padding:.4rem .75rem;
  box-shadow:0 0 0 1px rgba(255,255,255,.03),0 8px 32px rgba(0,0,0,.5)}
.nav-brand{font-family:var(--heading);font-size:.82rem;font-weight:700;color:var(--sky);
  padding:.3rem .75rem;margin-right:.2rem;letter-spacing:-.01em}
.nav-tab{font-size:.78rem;font-weight:500;color:var(--muted);text-decoration:none;
  padding:.28rem .62rem;border-radius:99px;cursor:pointer;border:none;background:none;
  transition:color .2s,background .2s;white-space:nowrap}
.nav-tab:hover,.nav-tab.active{color:var(--text);background:rgba(255,255,255,.07)}
.nav-sep{width:1px;height:16px;background:var(--border-hi);margin:0 .3rem;flex-shrink:0}
.lang-btn{font-family:var(--mono);font-size:.72rem;font-weight:600;
  color:var(--sky);border:1px solid rgba(56,189,248,.25);background:var(--sky-dim);
  padding:.25rem .6rem;border-radius:6px;cursor:pointer;transition:all .2s;margin-left:.3rem}
.lang-btn:hover{background:rgba(56,189,248,.22)}

/* HERO */
.hero{padding:5rem 0 2.5rem;text-align:center}
.hero-badge{display:inline-flex;align-items:center;gap:.45rem;
  font-family:var(--mono);font-size:.7rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;
  color:var(--sky);background:var(--sky-dim);border:1px solid rgba(56,189,248,.18);
  padding:.32rem .85rem;border-radius:99px;margin-bottom:1.75rem}
.dot-pulse{width:6px;height:6px;border-radius:50%;background:var(--sky);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}
h1{font-family:var(--heading);font-size:clamp(2rem,5.5vw,3.4rem);font-weight:700;
  line-height:1.1;letter-spacing:-.03em;margin-bottom:1.2rem}
.h1-line1{display:block;background:linear-gradient(180deg,#ffffff 30%,#c4d6e8 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.h1-line2{display:block;background:linear-gradient(135deg,var(--sky) 0%,#818cf8 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hero-desc{color:var(--muted);font-size:1rem;max-width:520px;margin:0 auto .75rem;line-height:1.8}
.btns{display:flex;justify-content:center;flex-wrap:wrap;gap:.65rem;margin-top:2rem}
.btn{display:inline-flex;align-items:center;gap:.6rem;font-family:var(--body);font-size:.855rem;
  font-weight:600;padding:.6rem 1.25rem;border-radius:99px;text-decoration:none;
  transition:all .35s var(--ease);white-space:nowrap}
.btn-pri{background:var(--sky);color:#04111f;
  box-shadow:0 1px 0 rgba(255,255,255,.25) inset,0 6px 20px var(--sky-glow)}
.btn-pri:hover{filter:brightness(1.1);transform:translateY(-2px);box-shadow:0 1px 0 rgba(255,255,255,.25) inset,0 10px 28px var(--sky-glow)}
.btn-ghost{background:var(--surface);color:var(--text);border:1px solid var(--border-hi);
  box-shadow:0 1px 0 rgba(255,255,255,.04) inset}
.btn-ghost:hover{background:var(--surface-hover);border-color:rgba(255,255,255,.2);transform:translateY(-2px)}
.btn-ico{width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,.15);
  display:flex;align-items:center;justify-content:center;flex-shrink:0}

/* TABS */
.tab-section{display:none}.tab-section.active{display:block}
.section{margin:2.5rem 0}
.sec-hd{display:flex;align-items:center;gap:.8rem;font-family:var(--mono);font-size:.68rem;
  font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-bottom:1.5rem}
.sec-hd::after{content:'';flex:1;height:1px;background:var(--border)}

/* FEATURE CARDS */
.feat-grid{display:grid;grid-template-columns:1fr 1fr;gap:.875rem}
@media(max-width:640px){.feat-grid{grid-template-columns:1fr}}
.feat-card{position:relative;overflow:hidden;background:var(--surface);border:1px solid var(--border);
  border-radius:var(--r-lg);padding:1.5rem;
  transition:border-color .3s var(--ease),transform .4s var(--ease),box-shadow .4s var(--ease)}
.feat-card:hover{border-color:var(--border-hi);transform:translateY(-3px);box-shadow:0 12px 40px rgba(0,0,0,.4)}
.feat-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;
  border-radius:99px 0 0 99px;background:var(--strip,var(--sky));opacity:.8}
.feat-card.sky{--strip:var(--sky)}.feat-card.em{--strip:var(--emerald)}
.feat-card.am{--strip:var(--amber)}.feat-card.vi{--strip:var(--violet)}
.feat-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;
  justify-content:center;margin-bottom:1rem;background:var(--icon-bg,var(--sky-dim));
  box-shadow:0 0 16px var(--icon-glow,transparent)}
.feat-card.sky .feat-icon{--icon-bg:var(--sky-dim);--icon-glow:rgba(56,189,248,.15)}
.feat-card.em  .feat-icon{--icon-bg:var(--emerald-dim);--icon-glow:rgba(52,211,153,.15)}
.feat-card.am  .feat-icon{--icon-bg:var(--amber-dim);--icon-glow:rgba(251,191,36,.15)}
.feat-card.vi  .feat-icon{--icon-bg:var(--violet-dim);--icon-glow:rgba(167,139,250,.15)}
.feat-icon svg{width:18px;height:18px}
.feat-card.sky .feat-icon svg{color:var(--sky)}.feat-card.em .feat-icon svg{color:var(--emerald)}
.feat-card.am  .feat-icon svg{color:var(--amber)}.feat-card.vi .feat-icon svg{color:var(--violet)}
.feat-title{font-family:var(--heading);font-size:.97rem;font-weight:600;margin-bottom:.4rem;letter-spacing:-.01em}
.feat-body{color:var(--muted);font-size:.86rem;line-height:1.65}
.feat-tag{display:inline-flex;align-items:center;font-family:var(--mono);font-size:.68rem;font-weight:500;
  background:rgba(255,255,255,.06);border:1px solid var(--border-hi);color:var(--sky);
  padding:.15rem .5rem;border-radius:5px;margin:0 .15rem;vertical-align:middle}

/* API LIST */
.api-list{display:flex;flex-direction:column;gap:.75rem}
.api-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;
  transition:border-color .25s var(--ease)}
.api-card:hover{border-color:var(--border-hi)}
.api-card-head{display:flex;align-items:flex-start;gap:.9rem;padding:1rem 1.2rem;cursor:pointer;
  user-select:none}
.api-card-head:hover{background:rgba(255,255,255,.02)}
.method{font-family:var(--mono);font-size:.68rem;font-weight:600;letter-spacing:.06em;
  padding:.28rem .65rem;border-radius:6px;flex-shrink:0;margin-top:.18rem;min-width:46px;text-align:center}
.m-get{background:var(--emerald-dim);color:var(--emerald);border:1px solid rgba(52,211,153,.2)}
.m-post{background:var(--amber-dim);color:var(--amber);border:1px solid rgba(251,191,36,.2)}
.api-info{min-width:0;flex:1}
.api-path{font-family:var(--mono);font-size:.84rem;color:var(--sky);margin-bottom:.25rem;
  display:flex;align-items:center;flex-wrap:wrap;gap:.4rem}
.api-desc{color:var(--muted);font-size:.84rem;line-height:1.6}
.api-desc code{font-family:var(--mono);font-size:.78rem;background:rgba(56,189,248,.09);
  color:var(--sky);padding:.1rem .38rem;border-radius:4px}
.api-toggle{font-family:var(--mono);font-size:.7rem;color:var(--faint);margin-left:auto;
  flex-shrink:0;padding:.2rem .5rem;border:1px solid var(--border);border-radius:5px;
  background:none;cursor:pointer;transition:color .2s,border-color .2s;white-space:nowrap}
.api-toggle:hover{color:var(--sky);border-color:rgba(56,189,248,.3)}
.api-params{display:none;border-top:1px solid var(--border);overflow:hidden}
.api-params.open{display:block}
.params-tbl{width:100%;border-collapse:collapse;font-size:.82rem}
.params-tbl thead th{text-align:left;font-family:var(--mono);font-size:.66rem;letter-spacing:.1em;
  text-transform:uppercase;color:var(--faint);padding:.6rem 1.1rem;
  background:rgba(0,0,0,.2);border-bottom:1px solid var(--border)}
.params-tbl tbody tr{transition:background .15s}
.params-tbl tbody tr:hover{background:rgba(255,255,255,.02)}
.params-tbl td{padding:.65rem 1.1rem;border-bottom:1px solid rgba(255,255,255,.03);vertical-align:top;line-height:1.5}
.params-tbl td:first-child{font-family:var(--mono);font-size:.78rem;color:var(--sky);white-space:nowrap}
.params-tbl td:nth-child(2){font-family:var(--mono);font-size:.75rem;color:var(--amber)}
.params-tbl td:nth-child(3){color:var(--rose);font-family:var(--mono);font-size:.75rem}
.params-tbl td:nth-child(4){color:var(--faint);font-family:var(--mono);font-size:.75rem}
.params-tbl td:last-child{color:var(--muted)}
.req-badge{font-size:.66rem;font-family:var(--mono);padding:.1rem .4rem;border-radius:4px}
.req-y{background:rgba(248,113,113,.12);color:var(--rose);border:1px solid rgba(248,113,113,.2)}
.req-n{background:rgba(255,255,255,.05);color:var(--faint);border:1px solid var(--border)}

/* CODE BLOCK */
.code-wrap{background:rgba(0,0,0,.45);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.code-header{display:flex;align-items:center;justify-content:space-between;
  padding:.65rem 1.1rem;border-bottom:1px solid var(--border);background:rgba(0,0,0,.2);cursor:pointer}
.code-header:hover{background:rgba(0,0,0,.35)}
.code-dots{display:flex;gap:.4rem}
.code-dots span{width:10px;height:10px;border-radius:50%;background:var(--c,rgba(255,255,255,.12))}
.code-dots span:nth-child(1){--c:#ff5f57}.code-dots span:nth-child(2){--c:#febc2e}.code-dots span:nth-child(3){--c:#28c840}
.code-meta{display:flex;align-items:center;gap:.75rem}
.code-lang{font-family:var(--mono);font-size:.7rem;color:var(--faint);letter-spacing:.06em}
.code-toggle{font-family:var(--mono);font-size:.68rem;color:var(--faint);
  background:rgba(255,255,255,.05);border:1px solid var(--border);
  padding:.18rem .55rem;border-radius:4px;cursor:pointer;transition:color .2s}
.code-toggle:hover{color:var(--sky)}
.code-body{display:none}.code-body.open{display:block}
pre{padding:1.2rem 1.4rem;overflow-x:auto;font-family:var(--mono);font-size:.8rem;
  line-height:1.8;color:#d4dfe9;tab-size:2;white-space:pre-wrap;word-break:break-all}
pre .cmt{color:var(--faint)}pre .kw{color:var(--sky)}pre .fn{color:var(--emerald)}
pre .str{color:#fca5a5}pre .num{color:var(--amber)}

/* ENV TABLE */
.env-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden}
.env-table{width:100%;border-collapse:collapse;font-size:.86rem}
.env-table thead th{text-align:left;font-family:var(--mono);font-size:.68rem;
  letter-spacing:.1em;text-transform:uppercase;color:var(--faint);padding:.75rem 1.2rem;
  background:rgba(0,0,0,.2);border-bottom:1px solid var(--border)}
.env-table tbody tr{transition:background .2s}
.env-table tbody tr:hover{background:rgba(255,255,255,.025)}
.env-table td{padding:.85rem 1.2rem;border-bottom:1px solid rgba(255,255,255,.035)}
.env-table td:first-child{font-family:var(--mono);font-size:.8rem;color:var(--sky)}
.env-table td:nth-child(2){color:var(--muted)}
.env-table td:last-child{font-family:var(--mono);font-size:.78rem;color:var(--faint)}
.env-note{padding:1rem 1.2rem;font-size:.83rem;color:var(--muted);
  background:rgba(56,189,248,.04);border-top:1px solid var(--border)}
.env-note a{color:var(--sky);text-decoration:none}.env-note a:hover{text-decoration:underline}

/* TESTER */
.tester{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden}
.tester-head{padding:1rem 1.4rem;border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem;
  background:rgba(0,0,0,.18)}
.tester-head-title{font-family:var(--heading);font-size:.92rem;font-weight:600;letter-spacing:-.01em;
  display:flex;align-items:center;gap:.6rem}
.tester-head-title svg{width:16px;height:16px;color:var(--sky)}
.tester-body{padding:1.25rem 1.4rem;display:flex;flex-direction:column;gap:1rem}
.cred-row{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
@media(max-width:560px){.cred-row{grid-template-columns:1fr}}
.fld{display:flex;flex-direction:column;gap:.35rem}
.fld label{font-family:var(--mono);font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.fld input,.fld select,.fld textarea{font-family:var(--mono);font-size:.82rem;color:var(--text);
  background:rgba(0,0,0,.3);border:1px solid var(--border-hi);border-radius:8px;
  padding:.6rem .9rem;outline:none;width:100%;
  transition:border-color .2s var(--ease),box-shadow .2s var(--ease);
  appearance:none;-webkit-appearance:none}
.fld input:focus,.fld select:focus,.fld textarea:focus{border-color:var(--sky);box-shadow:0 0 0 3px rgba(56,189,248,.12)}
.fld input::placeholder{color:var(--faint);font-size:.78rem}
.fld select option{background:#0d1a2d}
.fld textarea{resize:vertical;min-height:80px;line-height:1.5}
.params-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
@media(max-width:560px){.params-grid{grid-template-columns:1fr}}
.action-row{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}
.send-btn{display:inline-flex;align-items:center;gap:.6rem;font-family:var(--body);font-size:.875rem;
  font-weight:600;background:var(--sky);color:#04111f;border:none;cursor:pointer;
  padding:.6rem 1.4rem;border-radius:99px;transition:all .3s var(--ease);
  box-shadow:0 4px 16px var(--sky-glow)}
.send-btn:hover{filter:brightness(1.1);transform:translateY(-1px);box-shadow:0 6px 20px var(--sky-glow)}
.send-btn:active{transform:scale(.97)}
.send-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.send-btn svg{width:15px;height:15px;transition:transform .3s var(--ease)}
.send-btn:hover svg{transform:translateX(2px)}
.status-badge{font-family:var(--mono);font-size:.75rem;padding:.28rem .75rem;border-radius:99px;
  border:1px solid transparent;display:none}
.status-badge.show{display:inline-flex;align-items:center;gap:.4rem}
.status-badge.ok{background:var(--emerald-dim);color:var(--emerald);border-color:rgba(52,211,153,.2)}
.status-badge.err{background:rgba(248,113,113,.1);color:var(--rose);border-color:rgba(248,113,113,.2)}
.status-badge.loading{background:var(--sky-dim);color:var(--sky);border-color:rgba(56,189,248,.2)}
.resp-wrap{display:none}.resp-wrap.show{display:block}
.resp-header{padding:.65rem 1.1rem;background:rgba(0,0,0,.25);border:1px solid var(--border);
  border-bottom:none;border-radius:var(--r) var(--r) 0 0;display:flex;justify-content:space-between;align-items:center}
.resp-header span{font-family:var(--mono);font-size:.72rem;color:var(--faint);letter-spacing:.06em}
.copy-btn{font-family:var(--mono);font-size:.7rem;color:var(--muted);background:rgba(255,255,255,.06);
  border:1px solid var(--border-hi);padding:.2rem .65rem;border-radius:5px;cursor:pointer;
  transition:color .2s,background .2s}
.copy-btn:hover{color:var(--text);background:rgba(255,255,255,.1)}
pre#resp-pre{background:rgba(0,0,0,.45);border:1px solid var(--border);border-radius:0 0 var(--r) var(--r);
  padding:1.1rem 1.3rem;overflow-x:auto;font-family:var(--mono);font-size:.78rem;line-height:1.75;
  color:#d4dfe9;max-height:480px;overflow-y:auto;white-space:pre-wrap;word-break:break-all}

/* FOOTER */
footer{padding:2rem 0;margin-top:3rem;border-top:1px solid var(--border);
  display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem}
footer .copy{color:var(--faint);font-size:.82rem}
footer a{color:var(--faint);text-decoration:none;transition:color .2s}
footer a:hover{color:var(--sky)}
.chips{display:flex;gap:.5rem;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:.4rem;font-family:var(--mono);font-size:.7rem;
  padding:.22rem .65rem;border-radius:99px}
.chip-ok{background:var(--emerald-dim);color:var(--emerald);border:1px solid rgba(52,211,153,.2)}
.chip-info{background:var(--sky-dim);color:var(--sky);border:1px solid rgba(56,189,248,.2)}
.reveal{opacity:0;transform:translateY(16px);transition:opacity .65s var(--ease),transform .65s var(--ease)}
.reveal.in{opacity:1;transform:none}
@media(max-width:700px){.nav-pill{gap:0}.nav-tab{padding:.25rem .45rem;font-size:.72rem}}
</style>
</head>
<body>
<div class="ambient"></div>
<div class="wrap">

<!-- NAV -->
<nav>
  <div class="nav-pill">
    <span class="nav-brand">⚡ Steam Proxy</span>
    <div class="nav-sep"></div>
    <button class="nav-tab active" onclick="switchTab('features')" id="tab-features" data-i18n="nav.features">特性</button>
    <button class="nav-tab" onclick="switchTab('api')" id="tab-api">API</button>
    <button class="nav-tab" onclick="switchTab('usage')" id="tab-usage" data-i18n="nav.usage">示例</button>
    <button class="nav-tab" onclick="switchTab('config')" id="tab-config" data-i18n="nav.config">配置</button>
    <button class="nav-tab" onclick="switchTab('test')" id="tab-test" data-i18n="nav.test">测试</button>
    <div class="nav-sep"></div>
    <button class="lang-btn" onclick="toggleLang()" id="lang-btn">EN</button>
  </div>
</nav>

<!-- HERO -->
<section class="hero reveal">
  <div class="hero-badge"><div class="dot-pulse"></div><span data-i18n="hero.badge">Edge Runtime · Hono Framework</span></div>
  <h1>
    <span class="h1-line1" data-i18n="hero.title1">Steam API 加速代理</span>
  </h1>
  <p class="hero-desc" data-i18n="hero.desc1">基于 Hono，支持 Cloudflare Workers、EdgeOne、Aliyun ESA 部署</p>
  <p class="hero-desc" data-i18n="hero.desc2">为国内应用提供稳定低延迟的 Steam Workshop API 访问通道。</p>
  <div class="btns">
    <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/PIKACHUIM/SteamWorkAPI"
       class="btn btn-pri" target="_blank" rel="noopener">
      <span class="btn-ico"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 2v9M4 7l4 4 4-4"/><path d="M2 14h12"/></svg></span>
      <span data-i18n="btn.cf">部署到 Cloudflare</span>
    </a>
    <a href="https://console.cloud.tencent.com/edgeone/edge-functions" class="btn btn-ghost" target="_blank" rel="noopener">
      <span class="btn-ico"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 2v9M4 7l4 4 4-4"/><path d="M2 14h12"/></svg></span>
      <span data-i18n="btn.eo">腾讯 EdgeOne</span>
    </a>
    <a href="https://esa.console.aliyun.com/" class="btn btn-ghost" target="_blank" rel="noopener">
      <span class="btn-ico"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 2v9M4 7l4 4 4-4"/><path d="M2 14h12"/></svg></span>
      <span data-i18n="btn.ali">阿里云 ESA</span>
    </a>
    <a href="https://github.com/PIKACHUIM/SteamWorkAPI" class="btn btn-ghost" target="_blank" rel="noopener">
      <span class="btn-ico"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.08-.73.08-.73 1.2.09 1.83 1.24 1.83 1.24 1.08 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3"/></svg></span>
      GitHub
    </a>
  </div>
</section>

<!-- TAB: FEATURES -->
<div class="tab-section active" id="section-features">
<section class="section">
  <p class="sec-hd" data-i18n="features.title">功能特性</p>
  <div class="feat-grid">
    <div class="feat-card sky reveal">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
      <div class="feat-title" data-i18n="feat1.title">三平台一键部署</div>
      <div class="feat-body" data-i18n="feat1.body">同一份代码无缝运行于 Cloudflare Workers、腾讯 EdgeOne 与阿里云 ESA，标准 V8 Isolate 运行时，零冷启动延迟。</div>
    </div>
    <div class="feat-card em reveal" style="transition-delay:.06s">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
      <div class="feat-title" data-i18n="feat2.title">仅限中国大陆访问</div>
      <div class="feat-body" data-i18n="feat2.body">内置 IP 地域检测中间件，海外访问自动返回 HTTP <strong style="color:var(--rose)">451</strong>，合规运营无后顾之忧。</div>
    </div>
    <div class="feat-card am reveal" style="transition-delay:.10s">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
      <div class="feat-title" data-i18n="feat3.title">边缘低延迟</div>
      <div class="feat-body" data-i18n="feat3.body">通过就近边缘节点代理，规避国内直连 Steam API 超时，P99 响应时间大幅降低。</div>
    </div>
    <div class="feat-card vi reveal" style="transition-delay:.14s">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg></div>
      <div class="feat-title" data-i18n="feat4.title">零代码配置</div>
      <div class="feat-body" data-i18n="feat4.body">API Key 与 App ID 通过环境变量注入，内置合理默认值。Fork 后直接部署，支持 <span class="feat-tag">STEAM_API_KEY</span> <span class="feat-tag">STEAM_APP_ID</span> 覆盖。</div>
    </div>
  </div>
</section>
</div>


<!-- TAB: API -->
<div class="tab-section" id="section-api">
<section class="section">
  <p class="sec-hd">API <span data-i18n="api.endpoints">端点</span></p>
  <div class="api-list">

    <!-- QueryFiles -->
    <div class="api-card reveal">
      <div class="api-card-head" onclick="toggleParams(this)">
        <span class="method m-get">GET</span>
        <div class="api-info">
          <div class="api-path">/IPublishedFileService/QueryFiles/v1/</div>
          <div class="api-desc" data-i18n="api.query.desc">查询 Workshop 文件列表，支持搜索、标签过滤、分页与排序。</div>
        </div>
        <button class="api-toggle" data-i18n="api.showParams">展开参数</button>
      </div>
      <div class="api-params">
        <table class="params-tbl">
          <thead><tr><th data-i18n="th.param">参数</th><th data-i18n="th.type">类型</th><th data-i18n="th.required">必填</th><th data-i18n="th.default">默认值</th><th data-i18n="th.desc">说明</th></tr></thead>
          <tbody>
            <tr><td>key</td><td>string</td><td><span class="req-badge req-n">否</span></td><td>env</td><td data-i18n="p.key">Steam API 密钥，留空使用服务端环境变量</td></tr>
            <tr><td>appid</td><td>number</td><td><span class="req-badge req-n">否</span></td><td>431960</td><td data-i18n="p.appid">目标 App ID，留空使用服务端默认值</td></tr>
            <tr><td>query_type</td><td>number</td><td><span class="req-badge req-n">否</span></td><td>0</td><td data-i18n="p.query_type">排序：0=热门 1=最新 3=订阅数 12=评分</td></tr>
            <tr><td>page</td><td>number</td><td><span class="req-badge req-n">否</span></td><td>1</td><td data-i18n="p.page">页码，从 1 开始</td></tr>
            <tr><td>numperpage</td><td>number</td><td><span class="req-badge req-n">否</span></td><td>10</td><td data-i18n="p.numperpage">每页数量，最大 100</td></tr>
            <tr><td>search_text</td><td>string</td><td><span class="req-badge req-n">否</span></td><td>—</td><td data-i18n="p.search_text">搜索关键词</td></tr>
            <tr><td>return_tags</td><td>bool</td><td><span class="req-badge req-n">否</span></td><td>false</td><td data-i18n="p.return_tags">返回结果中包含标签数组</td></tr>
            <tr><td>return_previews</td><td>bool</td><td><span class="req-badge req-n">否</span></td><td>false</td><td data-i18n="p.return_previews">返回预览图 URL</td></tr>
            <tr><td>return_metadata</td><td>bool</td><td><span class="req-badge req-n">否</span></td><td>false</td><td data-i18n="p.return_metadata">返回元数据</td></tr>
            <tr><td>requiredtags[N]</td><td>string</td><td><span class="req-badge req-n">否</span></td><td>—</td><td data-i18n="p.requiredtags">必须包含的标签，N 从 0 开始递增</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- GetPublishedFileDetails -->
    <div class="api-card reveal" style="transition-delay:.04s">
      <div class="api-card-head" onclick="toggleParams(this)">
        <span class="method m-post">POST</span>
        <div class="api-info">
          <div class="api-path">/ISteamRemoteStorage/GetPublishedFileDetails/v1/</div>
          <div class="api-desc" data-i18n="api.details.desc">批量获取 Workshop 文件详情，Body 使用 <code>application/x-www-form-urlencoded</code> 格式。</div>
        </div>
        <button class="api-toggle" data-i18n="api.showParams">展开参数</button>
      </div>
      <div class="api-params">
        <table class="params-tbl">
          <thead><tr><th data-i18n="th.param">参数</th><th data-i18n="th.type">类型</th><th data-i18n="th.required">必填</th><th data-i18n="th.default">默认值</th><th data-i18n="th.desc">说明</th></tr></thead>
          <tbody>
            <tr><td>itemcount</td><td>number</td><td><span class="req-badge req-y">是</span></td><td>—</td><td data-i18n="p.itemcount">请求的文件数量</td></tr>
            <tr><td>publishedfileids[N]</td><td>string</td><td><span class="req-badge req-y">是</span></td><td>—</td><td data-i18n="p.pubfileids">Workshop 文件 ID，N 从 0 开始</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Health -->
    <div class="api-card reveal" style="transition-delay:.08s">
      <div class="api-card-head" onclick="toggleParams(this)">
        <span class="method m-get">GET</span>
        <div class="api-info">
          <div class="api-path">/health</div>
          <div class="api-desc" data-i18n="api.health.desc">健康检查，返回服务状态 JSON。</div>
        </div>
        <button class="api-toggle" data-i18n="api.showParams">展开参数</button>
      </div>
      <div class="api-params">
        <table class="params-tbl">
          <thead><tr><th data-i18n="th.param">参数</th><th data-i18n="th.type">类型</th><th data-i18n="th.required">必填</th><th data-i18n="th.default">默认值</th><th data-i18n="th.desc">说明</th></tr></thead>
          <tbody>
            <tr><td colspan="5" style="color:var(--faint);text-align:center;font-family:var(--mono);font-size:.8rem" data-i18n="api.noparams">无参数</td></tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>
</section>
</div>


<!-- TAB: USAGE -->
<div class="tab-section" id="section-usage">
<section class="section">
  <p class="sec-hd" data-i18n="usage.title">使用示例</p>

  <!-- TypeScript -->
  <div class="code-wrap reveal" style="margin-bottom:1rem">
    <div class="code-header" onclick="toggleCode(this)">
      <div class="code-dots"><span></span><span></span><span></span></div>
      <div class="code-meta">
        <span class="code-lang">TypeScript / JavaScript</span>
        <button class="code-toggle" data-i18n="code.expand">展开</button>
      </div>
    </div>
    <div class="code-body">
<pre><span class="cmt">// 1. 查询 Workshop 文件（分页 + 搜索）</span>
<span class="kw">const</span> res = <span class="kw">await</span> <span class="fn">fetch</span>(
  <span class="str">'/IPublishedFileService/QueryFiles/v1/'</span>
  + <span class="str">'?appid=431960&query_type=0&page=1&numperpage=20'</span>
  + <span class="str">'&search_text=anime&return_tags=true&return_previews=true'</span>
);
<span class="kw">const</span> data = <span class="kw">await</span> res.<span class="fn">json</span>();

<span class="cmt">// 2. 批量获取文件详情（POST, form-urlencoded）</span>
<span class="kw">const</span> ids = [<span class="str">'3012345678'</span>, <span class="str">'2987654321'</span>];
<span class="kw">const</span> body = <span class="str">'itemcount='</span> + ids.length
  + ids.<span class="fn">map</span>((id, i) => <span class="str">\`&publishedfileids[\${i}]=\${id}\`</span>).<span class="fn">join</span>(<span class="str">''</span>);
<span class="kw">const</span> detail = <span class="kw">await</span> <span class="fn">fetch</span>(
  <span class="str">'/ISteamRemoteStorage/GetPublishedFileDetails/v1/'</span>, {
    method: <span class="str">'POST'</span>,
    headers: { <span class="str">'Content-Type'</span>: <span class="str">'application/x-www-form-urlencoded'</span> },
    body,
  }
);

<span class="cmt">// 3. 获取热门内容（query_type=0）</span>
<span class="kw">const</span> trending = <span class="kw">await</span> <span class="fn">fetch</span>(
  <span class="str">'/IPublishedFileService/QueryFiles/v1/'</span>
  + <span class="str">'?appid=431960&query_type=0&numperpage=10'</span>
);

<span class="cmt">// 4. 按标签查询（Live Wallpaper）</span>
<span class="kw">const</span> tagged = <span class="kw">await</span> <span class="fn">fetch</span>(
  <span class="str">'/IPublishedFileService/QueryFiles/v1/'</span>
  + <span class="str">'?appid=431960&requiredtags[0]=Live+Wallpaper&query_type=12'</span>
);</pre>
    </div>
  </div>

  <!-- Swift -->
  <div class="code-wrap reveal" style="margin-bottom:1rem;transition-delay:.05s">
    <div class="code-header" onclick="toggleCode(this)">
      <div class="code-dots"><span></span><span></span><span></span></div>
      <div class="code-meta">
        <span class="code-lang">Swift (URLSession)</span>
        <button class="code-toggle" data-i18n="code.expand">展开</button>
      </div>
    </div>
    <div class="code-body">
<pre><span class="cmt">// 1. 查询文件（将 base URL 替换为代理地址）</span>
<span class="kw">let</span> baseURL = <span class="str">"https://your-worker.your-name.workers.dev"</span>
<span class="kw">var</span> components = <span class="fn">URLComponents</span>(
  string: baseURL + <span class="str">"/IPublishedFileService/QueryFiles/v1/"</span>
)!
components.queryItems = [
  <span class="fn">URLQueryItem</span>(name: <span class="str">"appid"</span>,  value: <span class="str">"431960"</span>),
  <span class="fn">URLQueryItem</span>(name: <span class="str">"query_type"</span>, value: <span class="str">"0"</span>),
  <span class="fn">URLQueryItem</span>(name: <span class="str">"numperpage"</span>, value: <span class="str">"20"</span>),
]
<span class="kw">let</span> (data, _) = <span class="kw">try await</span> URLSession.shared.<span class="fn">data</span>(from: components.url!)

<span class="cmt">// 2. 批量获取详情（POST form）</span>
<span class="kw">var</span> request = <span class="fn">URLRequest</span>(url: <span class="fn">URL</span>(string: baseURL
  + <span class="str">"/ISteamRemoteStorage/GetPublishedFileDetails/v1/"</span>)!)
request.httpMethod = <span class="str">"POST"</span>
request.httpBody = <span class="str">"itemcount=2&publishedfileids[0]=3012345678&publishedfileids[1]=2987654321"</span>
  .<span class="fn">data</span>(using: .utf8)
request.<span class="fn">setValue</span>(<span class="str">"application/x-www-form-urlencoded"</span>,
  forHTTPHeaderField: <span class="str">"Content-Type"</span>)
<span class="kw">let</span> (detail, _) = <span class="kw">try await</span> URLSession.shared.<span class="fn">data</span>(for: request)</pre>
    </div>
  </div>

  <!-- curl -->
  <div class="code-wrap reveal" style="transition-delay:.1s">
    <div class="code-header" onclick="toggleCode(this)">
      <div class="code-dots"><span></span><span></span><span></span></div>
      <div class="code-meta">
        <span class="code-lang">cURL</span>
        <button class="code-toggle" data-i18n="code.expand">展开</button>
      </div>
    </div>
    <div class="code-body">
<pre><span class="cmt"># 查询热门内容</span>
curl <span class="str">"https://your-worker.workers.dev/IPublishedFileService/QueryFiles/v1/?appid=431960&query_type=0&numperpage=10"</span>

<span class="cmt"># 批量获取文件详情（POST form）</span>
curl -X POST <span class="str">"https://your-worker.workers.dev/ISteamRemoteStorage/GetPublishedFileDetails/v1/"</span> \
  -d <span class="str">"itemcount=2&publishedfileids[0]=3012345678&publishedfileids[1]=2987654321"</span>

<span class="cmt"># 健康检查</span>
curl <span class="str">"https://your-worker.workers.dev/health"</span></pre>
    </div>
  </div>
</section>
</div>


<!-- TAB: CONFIG -->
<div class="tab-section" id="section-config">
<section class="section">
  <p class="sec-hd" data-i18n="config.title">环境变量</p>
  <div class="env-card reveal">
    <table class="env-table">
      <thead>
        <tr><th data-i18n="th.var">变量名</th><th data-i18n="th.vardesc">说明</th><th data-i18n="th.vardefault">默认值</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>STEAM_API_KEY</td>
          <td data-i18n="env.key.desc">Steam Web API 密钥</td>
          <td>C3CBFF169F…E7</td>
        </tr>
        <tr>
          <td>STEAM_APP_ID</td>
          <td data-i18n="env.appid.desc">目标 Steam App ID（Mirage Wallpaper）</td>
          <td>431960</td>
        </tr>
        <tr>
          <td>STEAM_BASE</td>
          <td data-i18n="env.base.desc">上游 Steam API 地址，可替换为镜像或自定义代理</td>
          <td style="font-size:.72rem">api.steampowered.com</td>
        </tr>
        <tr>
          <td>ALLOW_AREA</td>
          <td data-i18n="env.allowarea.desc">限制访问地区，填 CN 仅允许大陆，留空不限制</td>
          <td style="color:var(--faint)">（空）</td>
        </tr>
      </tbody>
    </table>
    <div class="env-note" data-i18n="env.note">
      前往 <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener">steamcommunity.com/dev/apikey</a> 申请专属 Key，在平台控制台的 Variables / 环境变量处覆盖默认值即可，无需修改代码。
    </div>
  </div>
</section>
</div>


<!-- TAB: TEST -->
<div class="tab-section" id="section-test">
<section class="section">
  <p class="sec-hd" data-i18n="test.title">API 测试</p>
  <div class="tester reveal">
    <div class="tester-head">
      <span class="tester-head-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>
        <span data-i18n="test.panel">在线测试</span>
      </span>
      <span style="font-size:.82rem;color:var(--faint)" data-i18n="test.hint">key 留空则使用服务端环境变量</span>
    </div>
    <div class="tester-body">
      <div class="cred-row">
        <div class="fld">
          <label data-i18n="test.apikey">API Key <span style="color:var(--faint);text-transform:none;letter-spacing:0">（可选）</span></label>
          <input id="t-apikey" type="text" placeholder="留空使用服务端默认" autocomplete="off" spellcheck="false">
        </div>
        <div class="fld">
          <label data-i18n="test.appid">App ID <span style="color:var(--faint);text-transform:none;letter-spacing:0">（可选）</span></label>
          <input id="t-appid" type="text" placeholder="留空使用默认 431960" autocomplete="off">
        </div>
      </div>
      <div class="fld">
        <label data-i18n="test.endpoint">端点</label>
        <select id="t-endpoint" onchange="onEndpointChange()">
          <option value="query">GET /IPublishedFileService/QueryFiles/v1/ — 查询文件</option>
          <option value="details">POST /ISteamRemoteStorage/GetPublishedFileDetails/v1/ — 批量详情</option>
          <option value="health">GET /health — 健康检查</option>
        </select>
      </div>
      <div id="t-params-query" class="params-grid t-params">
        <div class="fld"><label>search_text</label><input id="p-search_text" type="text" placeholder="搜索关键词（可选）"></div>
        <div class="fld"><label>query_type</label>
          <select id="p-query_type">
            <option value="0">0 — 热门</option>
            <option value="1">1 — 最新</option>
            <option value="3">3 — 订阅数</option>
            <option value="12">12 — 评分</option>
          </select>
        </div>
        <div class="fld"><label>page</label><input id="p-page" type="number" value="1" min="1"></div>
        <div class="fld"><label>numperpage</label><input id="p-numperpage" type="number" value="10" min="1" max="100"></div>
      </div>
      <div id="t-params-details" class="t-params" style="display:none">
        <div class="fld">
          <label data-i18n="test.ids">Workshop IDs <span style="color:var(--faint);text-transform:none;letter-spacing:0">（每行一个或逗号分隔）</span></label>
          <textarea id="p-ids" placeholder="3012345678&#10;2987654321"></textarea>
        </div>
      </div>
      <div id="t-params-none" class="t-params" style="display:none">
        <p style="color:var(--faint);font-size:.85rem" data-i18n="test.noparams">此端点无需参数，直接发送即可。</p>
      </div>
      <div class="action-row">
        <button class="send-btn" id="t-send" onclick="doTest()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          <span data-i18n="test.send">发送请求</span>
        </button>
        <span class="status-badge" id="t-status"></span>
      </div>
      <div class="resp-wrap" id="t-resp">
        <div class="resp-header">
          <span id="t-resp-label">RESPONSE</span>
          <button class="copy-btn" onclick="copyResp()" data-i18n="test.copy">复制</button>
        </div>
        <pre id="resp-pre"></pre>
      </div>
    </div>
  </div>
</section>
</div>

<!-- FOOTER -->
<footer>
  <span class="copy">Steam Workshop 代理 &nbsp;·&nbsp; 基于 <a href="https://hono.dev" target="_blank" rel="noopener">Hono v4</a> 构建 &nbsp;·&nbsp; <a href="https://github.com/PIKACHUIM/SteamWorkAPI" target="_blank" rel="noopener">GitHub</a></span>
  <div class="chips">
    <span class="chip chip-ok"><svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor"><circle cx="3" cy="3" r="3"/></svg> <span data-i18n="footer.status">服务正常</span></span>
    <span class="chip chip-info" data-i18n="footer.region">仅限中国大陆</span>
  </div>
</footer>

</div><!-- /wrap -->

<script>
// ── i18n ──────────────────────────────────────────────────────────────────
const I18N = {
  zh: {
    'nav.features':'特性','nav.usage':'示例','nav.config':'配置','nav.test':'测试',
    'hero.badge':'Edge Runtime · Hono Framework',
    'hero.title1':'Steam API 加速代理',
    'hero.desc1':'基于 Hono，支持 Cloudflare Workers、EdgeOne、Aliyun ESA 部署',
    'hero.desc2':'为国内应用提供稳定低延迟的 Steam Workshop API 访问通道。',
    'btn.cf':'部署到 Cloudflare','btn.eo':'腾讯 EdgeOne','btn.ali':'阿里云 ESA',
    'features.title':'功能特性',
    'feat1.title':'三平台一键部署','feat1.body':'同一份代码无缝运行于 Cloudflare Workers、腾讯 EdgeOne 与阿里云 ESA，标准 V8 Isolate 运行时，零冷启动延迟。',
    'feat2.title':'仅限中国大陆访问','feat2.body':'内置 IP 地域检测中间件，海外访问自动返回 HTTP 451，合规运营无后顾之忧。',
    'feat3.title':'边缘低延迟','feat3.body':'通过就近边缘节点代理，规避国内直连 Steam API 超时，P99 响应时间大幅降低。',
    'feat4.title':'零代码配置','feat4.body':'API Key 与 App ID 通过环境变量注入，内置合理默认值。Fork 后直接部署，支持 STEAM_API_KEY / STEAM_APP_ID 覆盖。',
    'api.endpoints':'端点','api.query.desc':'查询 Workshop 文件列表，支持搜索、标签过滤、分页与排序。',
    'api.details.desc':'批量获取 Workshop 文件详情，Body 使用 application/x-www-form-urlencoded 格式。',
    'api.health.desc':'健康检查，返回服务状态 JSON。',
    'api.showParams':'展开参数','api.hideParams':'收起参数','api.noparams':'无参数',
    'th.param':'参数','th.type':'类型','th.required':'必填','th.default':'默认值','th.desc':'说明',
    'th.var':'变量名','th.vardesc':'说明','th.vardefault':'默认值',
    'p.key':'Steam API 密钥，留空使用服务端环境变量',
    'p.appid':'目标 App ID，留空使用服务端默认值',
    'p.query_type':'排序：0=热门 1=最新 3=订阅数 12=评分',
    'p.page':'页码，从 1 开始','p.numperpage':'每页数量，最大 100',
    'p.search_text':'搜索关键词','p.return_tags':'返回结果中包含标签数组',
    'p.return_previews':'返回预览图 URL','p.return_metadata':'返回元数据',
    'p.requiredtags':'必须包含的标签，N 从 0 开始递增',
    'p.itemcount':'请求的文件数量','p.pubfileids':'Workshop 文件 ID，N 从 0 开始',
    'usage.title':'使用示例','code.expand':'展开','code.collapse':'收起',
    'config.title':'环境变量',
    'env.key.desc':'Steam Web API 密钥','env.appid.desc':'目标 Steam App ID（Mirage Wallpaper）','env.base.desc':'上游 Steam API 地址，可替换为镜像或自定义代理','env.allowarea.desc':'限制访问地区代码，如 CN 仅允许大陆 IP，留空则不限制任何地区',
    'env.note':'前往 steamcommunity.com/dev/apikey 申请专属 Key，在平台控制台的 Variables / 环境变量处覆盖默认值即可，无需修改代码。',
    'test.title':'API 测试','test.panel':'在线测试','test.hint':'key 留空则使用服务端环境变量',
    'test.apikey':'API Key','test.appid':'App ID',
    'test.endpoint':'端点','test.ids':'Workshop IDs','test.noparams':'此端点无需参数，直接发送即可。',
    'test.send':'发送请求','test.copy':'复制',
    'footer.status':'服务正常','footer.region':'仅限中国大陆',
  },
  en: {
    'nav.features':'Features','nav.usage':'Examples','nav.config':'Config','nav.test':'Test',
    'hero.badge':'Edge Runtime · Hono Framework',
    'hero.title1':'Steam API Accelerated Proxy',
    'hero.desc1':'Built on Hono, deploy to Cloudflare Workers, EdgeOne, or Aliyun ESA',
    'hero.desc2':'Provides stable, low-latency Steam Workshop API access for domestic apps.',
    'btn.cf':'Deploy to Cloudflare','btn.eo':'Tencent EdgeOne','btn.ali':'Alibaba ESA',
    'features.title':'Features',
    'feat1.title':'One-click multi-platform deploy','feat1.body':'The same code runs seamlessly on Cloudflare Workers, Tencent EdgeOne and Alibaba ESA. Standard V8 Isolate runtime, zero cold-start latency.',
    'feat2.title':'Mainland China only','feat2.body':'Built-in IP geolocation middleware. Overseas requests automatically receive HTTP 451, ensuring compliance.',
    'feat3.title':'Edge low latency','feat3.body':'Proxied through nearby edge nodes, avoiding direct-connection timeouts to Steam API from China. P99 response times greatly reduced.',
    'feat4.title':'Zero-code config','feat4.body':'API Key and App ID injected via environment variables with sensible defaults. Fork and deploy immediately. Supports STEAM_API_KEY / STEAM_APP_ID overrides.',
    'api.endpoints':'Endpoints','api.query.desc':'Query Workshop file list with search, tag filtering, pagination, and sorting.',
    'api.details.desc':'Batch-fetch Workshop file details. Body must be application/x-www-form-urlencoded.',
    'api.health.desc':'Health check, returns service status JSON.',
    'api.showParams':'Show params','api.hideParams':'Hide params','api.noparams':'No parameters',
    'th.param':'Parameter','th.type':'Type','th.required':'Required','th.default':'Default','th.desc':'Description',
    'th.var':'Variable','th.vardesc':'Description','th.vardefault':'Default',
    'p.key':'Steam API key; leave blank to use server env var',
    'p.appid':'Target App ID; leave blank to use server default',
    'p.query_type':'Sort: 0=trending 1=newest 3=subscriptions 12=rating',
    'p.page':'Page number, starting at 1','p.numperpage':'Items per page, max 100',
    'p.search_text':'Search keyword','p.return_tags':'Include tag arrays in results',
    'p.return_previews':'Return preview image URLs','p.return_metadata':'Return metadata',
    'p.requiredtags':'Required tag, N starts at 0',
    'p.itemcount':'Number of files to fetch','p.pubfileids':'Workshop file ID, N starts at 0',
    'usage.title':'Usage Examples','code.expand':'Expand','code.collapse':'Collapse',
    'config.title':'Environment Variables',
    'env.key.desc':'Steam Web API key','env.appid.desc':'Target Steam App ID (Mirage Wallpaper)','env.base.desc':'Upstream Steam API base URL, replaceable with a mirror or custom proxy','env.allowarea.desc':'Country code to restrict access, e.g. CN for mainland China only; empty = allow all',
    'env.note':'Get your own key at steamcommunity.com/dev/apikey, then override the default in your platform console — no code changes needed.',
    'test.title':'API Test','test.panel':'Live Test','test.hint':'Leave key blank to use server env var',
    'test.apikey':'API Key','test.appid':'App ID',
    'test.endpoint':'Endpoint','test.ids':'Workshop IDs','test.noparams':'No parameters needed for this endpoint.',
    'test.send':'Send Request','test.copy':'Copy',
    'footer.status':'Service OK','footer.region':'Mainland China only',
  }
}

let currentLang = 'zh'
function t(k){ return I18N[currentLang][k] || k }

function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n')
    if (k) el.textContent = t(k)
  })
  document.getElementById('lang-btn').textContent = currentLang === 'zh' ? 'EN' : '中文'
  document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en'
}

function toggleLang() {
  currentLang = currentLang === 'zh' ? 'en' : 'zh'
  applyLang()
}

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'))
  const sec = document.getElementById('section-' + name)
  const btn = document.getElementById('tab-' + name)
  if (sec) sec.classList.add('active')
  if (btn) btn.classList.add('active')
  window.scrollTo({ top: 0, behavior: 'smooth' })
  // trigger reveals inside newly-shown tab
  sec && sec.querySelectorAll('.reveal:not(.in)').forEach(el => io.observe(el))
}

// ── Code block toggle ──────────────────────────────────────────────────────
function toggleCode(header) {
  const body = header.nextElementSibling
  const btn = header.querySelector('.code-toggle')
  if (!body) return
  const isOpen = body.classList.toggle('open')
  if (btn) btn.textContent = isOpen ? t('code.collapse') : t('code.expand')
}

// ── API params toggle ──────────────────────────────────────────────────────
function toggleParams(head) {
  const params = head.nextElementSibling
  const btn = head.querySelector('.api-toggle')
  if (!params) return
  const isOpen = params.classList.toggle('open')
  if (btn) btn.textContent = isOpen ? t('api.hideParams') : t('api.showParams')
}

// ── Scroll reveal ──────────────────────────────────────────────────────────
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
  })
}, { threshold: 0.08 })
document.querySelectorAll('.reveal').forEach(el => io.observe(el))

// ── Test panel ─────────────────────────────────────────────────────────────
function onEndpointChange() {
  const ep = document.getElementById('t-endpoint').value
  document.querySelectorAll('.t-params').forEach(el => el.style.display = 'none')
  if (ep === 'query')   document.getElementById('t-params-query').style.display   = 'grid'
  if (ep === 'details') document.getElementById('t-params-details').style.display = 'block'
  if (ep === 'health')  document.getElementById('t-params-none').style.display    = 'block'
}
onEndpointChange()

function syntaxHL(json) {
  return json
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
      let cls = 'num'
      if (/^"/.test(m)) cls = /:$/.test(m) ? 'kw' : 'str'
      else if (/true|false/.test(m)) cls = 'fn'
      else if (/null/.test(m)) cls = 'cmt'
      return '<span class="' + cls + '">' + m + '</span>'
    })
}

async function doTest() {
  const btn      = document.getElementById('t-send')
  const badge    = document.getElementById('t-status')
  const respWrap = document.getElementById('t-resp')
  const pre      = document.getElementById('resp-pre')
  const ep       = document.getElementById('t-endpoint').value
  const apiKey   = document.getElementById('t-apikey').value.trim()
  const appId    = document.getElementById('t-appid').value.trim()

  btn.disabled = true
  badge.className = 'status-badge show loading'
  badge.textContent = t('test.send') + '...'

  try {
    let url, options = {}

    if (ep === 'health') {
      url = '/health'
    } else if (ep === 'query') {
      const params = new URLSearchParams()
      if (apiKey) params.set('key', apiKey)
      if (appId)  params.set('appid', appId)
      params.set('query_type', document.getElementById('p-query_type').value)
      params.set('page', document.getElementById('p-page').value)
      params.set('numperpage', document.getElementById('p-numperpage').value)
      const st = document.getElementById('p-search_text').value.trim()
      if (st) params.set('search_text', st)
      url = '/IPublishedFileService/QueryFiles/v1/?' + params.toString()
    } else if (ep === 'details') {
      const raw = document.getElementById('p-ids').value
      const ids = raw.split(/[,\s]+/).map(s=>s.trim()).filter(Boolean)
      if (!ids.length) { throw new Error('请输入至少一个 Workshop ID') }
      let body = 'itemcount=' + ids.length
      ids.forEach((id,i) => { body += '&publishedfileids[' + i + ']=' + id })
      url = '/ISteamRemoteStorage/GetPublishedFileDetails/v1/'
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      }
    }

    const t0 = Date.now()
    const res = await fetch(url, options)
    const ms  = Date.now() - t0

    document.getElementById('t-resp-label').textContent = 'RESPONSE  ' + res.status + '  ' + ms + 'ms'
    const text = await res.text()
    let display
    try { display = syntaxHL(JSON.stringify(JSON.parse(text), null, 2)) }
    catch { display = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
    pre.innerHTML = display
    respWrap.classList.add('show')
    badge.className = res.ok ? 'status-badge show ok' : 'status-badge show err'
    badge.textContent = res.ok ? '✓ ' + res.status + '  ' + ms + 'ms' : '✗ ' + res.status
  } catch(e) {
    pre.textContent = String(e)
    respWrap.classList.add('show')
    badge.className = 'status-badge show err'
    badge.textContent = '✗ ' + (e.message || 'Error')
  } finally {
    btn.disabled = false
  }
}

function copyResp() {
  const text = document.getElementById('resp-pre').textContent
  navigator.clipboard.writeText(text).catch(() => {})
  const btn = event.target
  const orig = btn.textContent
  btn.textContent = '✓'
  setTimeout(() => btn.textContent = orig, 1500)
}
</script>
</body>
</html>`
}


// ── Hono App ───────────────────────────────────────────────────────────────
const app = new Hono<{ Bindings: Env }>()

app.use('*', cors())

// ── Homepage ───────────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const country = getCountry(c.req.raw)
  const { allowArea } = getEnv(c.env)
  if (!isAllowed(country, allowArea)) {
    return c.html(blockedPage(country), 451)
  }
  return c.html(homePage(), 200)
})

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (c) => {
  return c.json({ status: 'ok', time: new Date().toISOString() })
})

// ── Transparent proxy helpers ──────────────────────────────────────────────

/**
 * Transparent proxy: forward the request to api.steampowered.com
 * and inject apiKey / appId from env when the caller omits them.
 */
async function proxyToSteam(c: import('hono').Context<{ Bindings: Env }>): Promise<Response> {
  const country = getCountry(c.req.raw)
  const { apiKey, appId, steamBase, allowArea } = getEnv(c.env)
  if (!isAllowed(country, allowArea)) {
    return new Response(blockedPage(country), {
      status: 451,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    })
  }

  const url = new URL(c.req.url)

  // Inject key / appid defaults for GET requests (query string)
  if (c.req.method === 'GET' || c.req.method === 'HEAD') {
    if (!url.searchParams.has('key'))   url.searchParams.set('key',   apiKey)
    if (!url.searchParams.has('appid')) url.searchParams.set('appid', appId)
  }

  const targetURL = steamBase + url.pathname + url.search

  // Build forwarded body for POST requests
  let forwardBody: BodyInit | null = null
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const ct = c.req.header('content-type') || ''
    const raw = await c.req.text()

    // Inject key / appid into form-urlencoded POST body if missing
    if (ct.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(raw)
      if (!params.has('key'))   params.set('key',   apiKey)
      if (!params.has('appid')) params.set('appid', appId)
      forwardBody = params.toString()
    } else {
      forwardBody = raw
    }
  }

  // Strip hop-by-hop headers before forwarding
  const forwardHeaders = new Headers()
  c.req.raw.headers.forEach((v, k) => {
    const skip = ['host', 'connection', 'keep-alive', 'proxy-authenticate',
                  'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade']
    if (!skip.includes(k.toLowerCase())) forwardHeaders.set(k, v)
  })
  forwardHeaders.set('host', 'api.steampowered.com')

  const upstream = await fetch(targetURL, {
    method:  c.req.method,
    headers: forwardHeaders,
    body:    forwardBody,
  })

  // Forward response headers (strip hop-by-hop)
  const respHeaders = new Headers()
  upstream.headers.forEach((v, k) => {
    const skip = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade']
    if (!skip.includes(k.toLowerCase())) respHeaders.set(k, v)
  })
  respHeaders.set('Access-Control-Allow-Origin', '*')

  return new Response(upstream.body, {
    status:  upstream.status,
    headers: respHeaders,
  })
}

// ── Steam API transparent proxy routes ────────────────────────────────────
// IPublishedFileService (GET)
app.all('/IPublishedFileService/:method/:version', (c) => proxyToSteam(c))
app.all('/IPublishedFileService/:method/:version/', (c) => proxyToSteam(c))

// ISteamRemoteStorage (POST for GetPublishedFileDetails)
app.all('/ISteamRemoteStorage/:method/:version', (c) => proxyToSteam(c))
app.all('/ISteamRemoteStorage/:method/:version/', (c) => proxyToSteam(c))

// Generic catch-all for any other Steam API interface (ISteamUser, etc.)
app.all('/:iface{I[A-Za-z]+}/:method/:version', (c) => proxyToSteam(c))
app.all('/:iface{I[A-Za-z]+}/:method/:version/', (c) => proxyToSteam(c))

// ── Export ─────────────────────────────────────────────────────────────────
export default app
