// API 工具函数 - 用于与后端通信

function getCookie(name: string): string | null {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [key, value] = cookie.trim().split('=');
    if (key === name) {
      return decodeURIComponent(value);
    }
  }
  return null;
}

function getToken(): string | null {
  return (window as any).__SUPABASE_ACCESS_TOKEN__ || getCookie('access_token');
}

async function apiFetch<T = any>(
  url: string,
  options?: RequestInit
): Promise<{ success: boolean; data?: T; error?: string }> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    const result = await response.json();
    return result;
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error' };
  }
}

// 退款计算记录 API
export const refundCalculationApi = {
  // 获取所有计算记录
  getAll: () => apiFetch('/api/refund-calculations'),

  // 获取单个计算记录
  getById: (id: number) => apiFetch(`/api/refund-calculations/${id}`),

  // 创建新计算记录
  create: (data: Record<string, any>) =>
    apiFetch('/api/refund-calculations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // 更新计算记录
  update: (id: number, data: Record<string, any>) =>
    apiFetch(`/api/refund-calculations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // 删除计算记录（软删除）
  delete: (id: number) =>
    apiFetch(`/api/refund-calculations/${id}`, {
      method: 'DELETE',
    }),

  // 获取使用统计
  getStats: () => apiFetch<{
    totalCount: number;
    platformDistribution: Record<string, number>;
    roleDistribution: Record<string, number>;
    dailyTrend: Array<{ date: string; count: number }>;
  }>('/api/refund-calculations/stats'),
};

export default apiFetch;
