import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlRoot = path.join(__dirname, '..', '..');

/**
 * Token injection middleware for the SPA fallback route.
 *
 * Supports two query parameter sources（任何一组命中即注入）：
 *   1. ?access_token=&refresh_token=
 *      —— 顶层跳转 / 平台 OAuth 链路（原有），注入 window.__SUPABASE_*
 *   2. ?ticket=<uuid>
 *      —— 第三方 iframe 嵌入鉴权（如钉钉 AI 表格）。注入一段补丁脚本：
 *         a) 把 ticket 存 sessionStorage，兜底 SPA pushState 摘掉 URL 后的刷新
 *         b) monkey-patch window.fetch：对 /aitable/v2/* 请求，若 Authorization
 *            缺失或为 'Bearer' / 'Bearer null' / 'Bearer undefined' 空载，
 *            自动补 'Bearer <ticket>'。让已部署但前端代码没 ticket 处理
 *            逻辑的老产物**无需重新部署**即可在 iframe 内跑通。
 *
 * 两组参数可同时存在；无参数时 fall through 到静态文件托管。
 */
function jsString(value: string): string {
  // 把 </script> 等敏感序列拆掉，避免提前闭合 <script> 标签
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function createTokenInjectionMiddleware() {
  return (req: any, res: any, next: any) => {
    // Only intercept root path requests
    if (req.path !== '/') {
      return next();
    }
    const accessToken = req.query.access_token as string | undefined;
    const refreshToken = req.query.refresh_token as string | undefined;
    const ticket = req.query.ticket as string | undefined;

    const hasSupabasePair = !!(accessToken && refreshToken);
    const hasTicket = !!ticket;

    if (!hasSupabasePair && !hasTicket) {
      return next();
    }

    const htmlPath = path.join(htmlRoot, 'index.html');
    fs.readFile(htmlPath, 'utf8', (err: NodeJS.ErrnoException | null, html: string) => {
      if (err) {
        console.error('[TokenInjection] Failed to read index.html:', err);
        res.status(500).send('Internal Server Error');
        return;
      }

      const blocks: string[] = [];

      if (hasSupabasePair) {
        blocks.push(`var query = new URLSearchParams(location.search);
window.__SUPABASE_ANON_KEY__ = '';
window.__SUPABASE_ACCESS_TOKEN__ = query.get('access_token') || ${jsString(accessToken!)};
window.__SUPABASE_REFRESH_TOKEN__ = query.get('refresh_token') || ${jsString(refreshToken!)};`);
      }

      if (hasTicket) {
        // 注意：此段脚本会在产物自身 JS 之前执行。monkey-patch 仅在 Authorization
        // 为空或空载（Bearer / Bearer null / Bearer undefined）时补 ticket，
        // 已带有效 Bearer JWT 的请求保持不变，避免覆盖已有登录态。
        blocks.push(`(function(){
  var TICKET_KEY = '__aiapp_ticket__';
  var initial = ${jsString(ticket!)};
  try {
    var qp = new URLSearchParams(location.search).get('ticket');
    if (qp) initial = qp;
  } catch (_) {}
  try { if (initial) sessionStorage.setItem(TICKET_KEY, initial); } catch (_) {}

  function getTicket() {
    try {
      var cur = new URL(location.href).searchParams.get('ticket');
      if (cur) return cur;
    } catch (_) {}
    try { return sessionStorage.getItem(TICKET_KEY); } catch (_) { return null; }
  }
  window.__AIAPP_GET_TICKET__ = getTicket;

  var EMPTY_BEARER_RE = /^Bearer(\\s+(null|undefined))?\\s*$/i;
  var AITABLE_RE = /\\/aitable\\/v2\\//;

  if (typeof window.fetch === 'function' && !window.__AIAPP_FETCH_TICKET_PATCHED__) {
    window.__AIAPP_FETCH_TICKET_PATCHED__ = true;
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string'
          ? input
          : (input && typeof input.url === 'string' ? input.url : '');
        if (AITABLE_RE.test(url)) {
          var tk = getTicket();
          if (tk) {
            init = init || {};
            var srcHeaders = init.headers
              || (typeof input !== 'string' && input && input.headers)
              || {};
            var headers = new Headers(srcHeaders);
            var existing = headers.get('Authorization');
            var blank = !existing || EMPTY_BEARER_RE.test(String(existing).trim());
            if (blank) {
              headers.set('Authorization', 'Bearer ' + tk);
              init.headers = headers;
            }
          }
        }
      } catch (_) {}
      return origFetch(input, init);
    };
  }
})();`);
      }

      const tokenScript = `<script>\n${blocks.join('\n')}\n</script>`;
      const injectedHtml = html.replace(/<\/title>/, `</title>\n${tokenScript}`);
      res.type('html').send(injectedHtml);
    });
  };
}
