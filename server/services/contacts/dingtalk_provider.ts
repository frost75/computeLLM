// ============================================================
// DingtalkContactsProvider
// Calls the platform member search API directly from server-side.
//
// Authentication flow (server-side):
//   1. Receive Supabase JWT from constructor (passed from request context)
//   2. Call POST /api/platform/members/search with Bearer JWT token
//
// The Supabase JWT is obtained from the request's Authorization header
// and passed to this provider by the calling service.
// ============================================================

import {
  IContactsProvider,
  Employee,
  Department,
  DepartmentTreeResult,
  DeptSearchResult,
  SearchResult,
  UserProfile,
  CreateUserInput,
  UpdateUserInput,
} from './interface.js';

import {ENV} from "../../_core/env.js";

function getPlatformOrigin(): string {
  return (
    (globalThis as any).__AI_APP_PLATFORM_ORIGIN__ ||
    ENV.aiappPlatformOrigin
  );
}

interface PlatformDeptRef {
  dept_id: string;
  name: string;
}

interface PlatformMemberItem {
  user_id: string;
  name: string;
  avatar?: string | null;
  dept_list?: PlatformDeptRef[] | null;
}

interface PlatformMemberSearchResponse {
  items: PlatformMemberItem[];
  total: number;
  offset: number;
  has_more: boolean;
}

// Map platform API member item to Employee interface
function mapToEmployee(item: PlatformMemberItem): Employee {
  return {
    emp_id: item.user_id,
    name: item.name || '',
    avatar: item.avatar ?? null,
    dept_list: item.dept_list ?? [],
  };
}

export class DingtalkContactsProvider implements IContactsProvider {
  // Supabase JWT token for authentication
  private supabaseJwt: string;

  constructor(supabaseJwt: string) {
    if (!supabaseJwt) {
      throw new Error(
        'DingtalkContactsProvider: Supabase JWT is required. ' +
        'Pass the JWT token from request Authorization header.',
      );
    }
    this.supabaseJwt = supabaseJwt;
  }

  // ---- Member search ----

  private async doSearchRequest(
    query: string,
    offset: number,
    limit: number,
  ): Promise<Response> {
    return fetch(`${getPlatformOrigin()}/api/platform/members/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.supabaseJwt}`,
      },
      body: JSON.stringify({ query, offset, limit }),
    });
  }

  // ---- Employee ----

  async searchEmployees(
    query: string,
    offset = 0,
    limit = 10,
  ): Promise<SearchResult<Employee>> {
    const resp = await this.doSearchRequest(query, offset, limit);

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Platform member search failed: ${resp.status} ${body}`);
    }

    const data: PlatformMemberSearchResponse = await resp.json();
    return {
      items: (data.items || []).map(mapToEmployee),
      total: data.total ?? 0,
      offset: data.offset ?? offset,
      has_more: data.has_more ?? false,
    };
  }

  async getEmployeeById(emp_id: string): Promise<Employee | null> {
    const resp = await fetch(
      `${getPlatformOrigin()}/api/platform/members/by-staff-id/${encodeURIComponent(emp_id)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.supabaseJwt}`,
        },
      },
    );

    if (resp.status === 404) return null;
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Platform get member by emp_id failed: ${resp.status} ${body}`);
    }

    const item: PlatformMemberItem | null = await resp.json();
    if (!item) return null;
    return mapToEmployee(item);
  }

  async listEmployeesByDept(
    _dept_id: string,
    _offset = 0,
    _limit = 50,
  ): Promise<SearchResult<Employee>> {
    throw new Error('listEmployeesByDept is not supported by DingtalkContactsProvider');
  }

  // ---- Department ----

  async listDepartments(_parent_id?: string): Promise<Department[]> {
    throw new Error('listDepartments is not supported by DingtalkContactsProvider');
  }

  async getDepartmentTree(deptId = '-1'): Promise<DepartmentTreeResult> {
    const params = new URLSearchParams({ dept_id: deptId });
    const resp = await fetch(`${getPlatformOrigin()}/api/platform/depts/tree?${params}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.supabaseJwt}` },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`getDepartmentTree failed: ${resp.status} ${body}`);
    }

    const data = await resp.json();
    return {
      items: data.items || [],
      total: data.total ?? 0,
    };
  }

  async getDepartmentById(dept_id: string): Promise<Department | null> {
    const resp = await fetch(
      `${getPlatformOrigin()}/api/platform/depts/${encodeURIComponent(dept_id)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.supabaseJwt}` },
      },
    );

    if (resp.status === 404) return null;
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`getDepartmentById failed: ${resp.status} ${body}`);
    }

    const data = await resp.json();
    if (!data) return null;
    return {
      dept_id: data.dept_id || dept_id,
      name: data.name || '',
      parent_id: '',
      member_count: 0,
      dept_full_path: data.dept_full_path || undefined,
    };
  }

  async searchDepts(key: string, offset = 0, limit = 50): Promise<DeptSearchResult> {
    const params = new URLSearchParams({
      key,
      offset: String(offset),
      limit: String(limit),
    });
    const resp = await fetch(`${getPlatformOrigin()}/api/platform/depts/search?${params}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.supabaseJwt}` },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`searchDepts failed: ${resp.status} ${body}`);
    }

    const data = await resp.json();
    return {
      items: data.items || [],
      total: data.total ?? 0,
    };
  }

  // ---- User management (not supported) ----

  async listUsers(): Promise<SearchResult<UserProfile>> {
    throw new Error('listUsers is not supported by DingtalkContactsProvider');
  }

  async getUserById(emp_id: string): Promise<UserProfile | null> {
    const resp = await fetch(
      `${getPlatformOrigin()}/api/platform/members/by-staff-id/${encodeURIComponent(emp_id)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.supabaseJwt}`,
        },
      },
    );

    if (resp.status === 404) return null;
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Platform get user by id failed: ${resp.status} ${body}`);
    }

    const item: PlatformMemberItem | null = await resp.json();
    if (!item) return null;
    return {
      emp_id: item.user_id,
      corp_id: '',
      name: item.name || '',
      avatar: item.avatar ?? null,
      // UserProfile.dept_id_list is the write-shape input field — flatten dept_list
      dept_id_list: (item.dept_list ?? []).map((d) => d.dept_id),
    };
  }

  async createUser(_input: CreateUserInput): Promise<UserProfile> {
    throw new Error('createUser is not supported by DingtalkContactsProvider');
  }

  async updateUser(_emp_id: string, _input: UpdateUserInput): Promise<UserProfile> {
    throw new Error('updateUser is not supported by DingtalkContactsProvider');
  }

  async deleteUser(_emp_id: string): Promise<void> {
    throw new Error('deleteUser is not supported by DingtalkContactsProvider');
  }
}
