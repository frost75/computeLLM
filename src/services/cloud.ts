import type { CaseFile } from "../domain/contracts";
export const cloudEnabled = !["localhost", "127.0.0.1", "[::1]"].includes(
  location.hostname,
);
function token() {
  const cookie = document.cookie
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("access_token="));
  return (
    (window as unknown as { __SUPABASE_ACCESS_TOKEN__?: string })
      .__SUPABASE_ACCESS_TOKEN__ ??
    (cookie ? decodeURIComponent(cookie.slice(13)) : null)
  );
}
let loginUrl: string | undefined;
export const cloudLoginUrl = () => loginUrl;
export async function cloudRequest(
  path: string,
  method = "GET",
  body?: unknown,
) {
  const auth = token();
  const response = await fetch("/api/cases" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("云端保存接口未部署");
  }
  if (response.status === 401 && typeof data.login_url === "string")
    loginUrl = data.login_url;
  if (!response.ok || !data.success)
    throw new Error(
      response.status === 401
        ? "登录已过期，云端待同步"
        : (data.error ?? `云端返回${response.status}`),
    );
  return data.data;
}
export async function hash(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function imageIds(record: CaseFile) {
  const ids = new Set<string>();
  for (const snap of [record.draft, ...record.revisions.map((r) => r.snapshot)])
    for (const order of [snap.original, snap.current])
      if (order.imageId) ids.add(order.imageId);
  return [...ids];
}
