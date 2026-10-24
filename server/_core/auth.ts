import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { UserContext } from '../lib/user-context.js';
import { ENV } from './env.js';


/**
 * Authentication middleware for all /api routes.
 * Extracts Bearer token from Authorization header, validates it via Supabase,
 * and mounts req.user (UserContext) and req.supabase on the request object.
 *
 * 支持免登白名单：命中白名单的路径直接放行（有 token 时仍尝试挂载用户上下文）。
 */
export async function need_login(req: any, res: any, next: any) {
  const requestPath = req.originalUrl || req.url;
  try {
    const isPublic = isPublicRoute(req.method, req.path || '');
    const token = extractToken(req);

    // 尝试验证 token 并挂载用户上下文
    if (token) {
      try {
        const result = await verifyToken(token);
        if (result) mountUserContext(req, result.user, result.supabase);
      } catch {
        // token 解析失败：免登接口忽略，需登录接口下方会再次拦截
      }
    }

    // 保证所有请求都有 req.supabase（匿名用户用 anon key 创建客户端，受 RLS 控制）
    if (!req.supabase) {
      req.supabase = createClient(ENV.supabaseUrl!, ENV.supabaseAnonKey!);
    }

    // 免登接口且没有登录用户时，构建访客身份
    // 参考 app_oauth.py 访客逻辑：用确定性标识 free_visitor_{app_id} 构造共享匡名身份
    if (isPublic && !req.user) {
      req.user = new UserContext({
        corp_id: 'anonymous',
        emp_id: `free_visitor_${ENV.appId}`,
        name: '访客',
        avatar: '',
        app_id: ENV.appId,
      });
    }

    // 免登接口：无论 token 是否有效都放行
    if (isPublic) return next();

    // 需登录接口：必须有有效的用户上下文
    if (!req.user) {
      const loginUrl = buildLoginRedirectUrl(req);
      const reason = !token ? 'No token found' :  'Token verification failed';
      console.warn(`[NeedLogin] ${reason}, path=${requestPath}`);
      res.status(401).json({
        code: 'UNAUTHORIZED',
        message: '请先登录',
        login_url: loginUrl,
      });
      return;
    }

    next();
  } catch (e) {
    const loginUrl = buildLoginRedirectUrl(req);
    console.error(`[NeedLogin] Unexpected error during auth. path=${requestPath}, error=`, e);
    res.status(401).json({
      code: 'UNAUTHORIZED',
      message: '认证异常，请重新登录',
      login_url: loginUrl,
    });
  }
}

/**
 * 免登白名单配置项。
 *
 * - path:  匹配路径（相对于 /api 前缀之后的部分），支持精确匹配和通配符
 *   - `"/contacts/employees"`     精确匹配
 *   - `"/contacts/employees/*"`   单段通配符，匹配 /contacts/employees/123 但不匹配 /contacts/employees/123/dept
 *   - `"/contacts/**"`            多段通配符，匹配 /contacts/ 下所有子路径
 * - methods: 免登的 HTTP 方法列表，不传则所有方法均免登。
 *   典型用法：同一路径 GET 免登但 DELETE 需登录：
 *   `{ path: '/depts/:id', methods: ['GET'] }`
 */
interface PublicRoute {
  path: string;
  methods?: string[];  // undefined = 全部方法免登
}

/**
 * 免登路由白名单。
 *
 * 在此处直接配置免登接口，无需外部调用。
 * 路径为相对于 /api 前缀之后的部分。
 *
 * @example
 *  新增一条: GET /api/depts 免登，但 POST/PUT/DELETE 仍需登录
 *  { path: '/depts', methods: ['GET'] }
 */
const PUBLIC_ROUTES: PublicRoute[] = [
  // ─── 在下方添加免登路由 ───
  { path: '/health' },                              // 健康检查，所有方法免登
  // { path: '/depts', methods: ['GET'] },           // 仅 GET 免登
  // { path: '/depts/:id', methods: ['GET'] },       // GET 查看→免登，DELETE 删除→需登录
  // { path: '/contacts/employees/me' },             // 所有方法免登
  // { path: '/public/**' },                         // 多段通配符，所有方法免登
];

/**
 * 将路径模式编译为正则。
 *
 * 支持：
 * - `:param` → 命名参数（匹配 `[^/]+`）
 * - `*`      → 单段通配符（匹配 `[^/]+`）
 * - `**`     → 多段通配符（匹配 `.+`，跨路径段）
 * - 其余字符字面量
 */
function compilePathPattern(pattern: string): RegExp {
  // 先转义正则特殊字符（保留 : * 供后续处理）
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // 转义正则元字符（保留 : 和 *）
    .replace(/:\w+/g, '[^/]+')                 // :param → [^/]+
    .replace(/\*\*/g, '{{DOUBLE_STAR}}')        // 临时占位
    .replace(/\*/g, '[^/]+')                    // 单 * → [^/]+
    .replace(/\{\{DOUBLE_STAR\}\}/g, '.+');     // ** → .+
  return new RegExp(`^${escaped}$`);
}

/**
 * 判断请求是否命中免登白名单。
 */
function isPublicRoute(method: string, requestPath: string): boolean {
  const upperMethod = method.toUpperCase();
  for (const rule of PUBLIC_ROUTES) {
    const regex = compilePathPattern(rule.path);
    if (!regex.test(requestPath)) continue;
    // methods 未指定 → 所有方法免登
    if (!rule.methods) return true;
    // methods 指定了 → 仅匹配的方法免登
    if (rule.methods.map(m => m.toUpperCase()).includes(upperMethod)) return true;
  }
  return false;
}

/**
 * 构建登录跳转 URL。
 *
 * 将当前请求的完整 URL 作为 continue_url 参数传递给登录页，
 * 同时从 continue_url 中移除 aiapp_auth_token 参数（避免循环），
 * 如果原始请求中携带了 aiapp_auth_token 则单独透传给登录页。
 */
function buildLoginRedirectUrl(req: any): string {
  const protocol = req.protocol;
  const host = req.get('host');
  const pathname = req.path;
  const aiappAuthToken = req.query.aiapp_auth_token as string | undefined;

  // 构建干净的 query string，移除 aiapp_auth_token
  const cleanQueryParts: string[] = [];
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'aiapp_auth_token') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        cleanQueryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
      }
    } else {
      cleanQueryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }

  const cleanQueryString = cleanQueryParts.length > 0 ? '?' + cleanQueryParts.join('&') : '';
  const continueUrl = `${protocol}://${host}${pathname}${cleanQueryString}`;

  let loginUrl = `${ENV.aiappPlatformOrigin}/oauth/dingtalk-login?continue_url=${encodeURIComponent(continueUrl)}`;
  if (aiappAuthToken) {
    loginUrl += `&aiapp_auth_token=${encodeURIComponent(aiappAuthToken)}`;
  }
  return loginUrl;
}

/**
 * 从请求中提取 token（优先 Authorization header，其次 Cookie）
 */
function extractToken(req: any): string | null {
  const headerToken = req.headers.authorization?.split(' ')[1];
  const cookieToken = req.cookies?.access_token;
  return headerToken || cookieToken || null;
}

/**
 * 用 token 创建 Supabase 客户端并验证用户。
 * 返回 { user, supabase } 或 null（验证失败时）。
 */
async function verifyToken(token: string): Promise<{ user: any; supabase: SupabaseClient } | null> {
  const supabase = createClient(
    ENV.supabaseUrl!,
    ENV.supabaseAnonKey!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { user, supabase };
}

/**
 * 将 Supabase 用户信息挂载到 req 上（req.user + req.supabase）
 */
function mountUserContext(req: any, user: any, supabase: SupabaseClient): void {
  req.user = new UserContext({
    corp_id: user.user_metadata?.corp_id,
    corp_name: user.user_metadata?.corp_name,
    emp_id: user.user_metadata?.emp_id,
    name: user.user_metadata?.nick,
    avatar: user.user_metadata?.avatar,
    app_id: ENV.appId,
  });
  req.supabase = supabase;
}

