// ============================================================
// Unified Contacts Service Interface
// Both DingtalkContactsProvider and SupabaseContactsProvider
// must implement this interface.
// ============================================================

/** 员工归属部门的最小描述（ID 与名称成对，避免出现 ID 列表与名称数组错位的歧义）。 */
export interface EmployeeDeptRef {
  dept_id: string;
  name: string;
}

export interface Employee {
  emp_id: string;
  name: string;
  avatar: string | null;
  /** 员工归属部门列表（ID + 名称成对）。上游：OrgDeptService.getNewDeptMapByOrgIdAndStaffIds */
  dept_list: EmployeeDeptRef[];
  mobile?: string;
  email?: string;
  title?: string;
  job_number?: string;
}

export interface Department {
  dept_id: string;
  name: string;
  parent_id: string;
  member_count: number;
  manager_userid?: string;
  manager_name?: string;
  dept_full_path?: string;
}

export interface DepartmentNode {
  dept_id: string;
  name: string;
  has_children?: boolean;
  dept_full_path?: string;
}

/** getDepartmentTree result */
export interface DepartmentTreeResult {
  items: DepartmentNode[];
  total: number;
}

/** Department search result item */
export interface DeptSearchItem {
  dept_id: string;
  name: string;
  dept_full_path?: string;
}

/** searchDepts result */
export interface DeptSearchResult {
  items: DeptSearchItem[];
  total: number;
}

export interface SearchResult<T> {
  items: T[];
  total: number;
  offset: number;
  has_more: boolean;
}

// ---- User management types (write operations) ----

export interface UserProfile {
  emp_id: string;
  corp_id: string;
  name: string;
  avatar?: string | null;
  email?: string;
  mobile?: string;
  title?: string;
  job_number?: string;
  dept_id_list?: string[];
  role?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  corp_id: string;
  role?: string;
  title?: string;
  job_number?: string;
  dept_id_list?: string[];
  mobile?: string;
}

export interface UpdateUserInput {
  name?: string;
  avatar?: string;
  email?: string;
  mobile?: string;
  title?: string;
  job_number?: string;
  dept_id_list?: string[];
  role?: string;
  is_active?: boolean;
}

export interface IContactsProvider {
  // ---- Employee (read-only, works for both DingTalk and Supabase) ----
  searchEmployees(query: string, offset?: number, limit?: number): Promise<SearchResult<Employee>>;
  getEmployeeById(emp_id: string): Promise<Employee | null>;
  listEmployeesByDept(dept_id: string, offset?: number, limit?: number): Promise<SearchResult<Employee>>;

  // ---- Department (read-only) ----
  listDepartments(parent_id?: string): Promise<Department[]>;
  getDepartmentTree(deptId?: string): Promise<DepartmentTreeResult>;
  getDepartmentById(dept_id: string): Promise<Department | null>;
  searchDepts(key: string, offset?: number, limit?: number): Promise<DeptSearchResult>;

  // ---- User management (write operations) ----
  // DingtalkContactsProvider returns null / throws UnsupportedError for these.
  // SupabaseContactsProvider provides full implementation.
  listUsers(offset?: number, limit?: number): Promise<SearchResult<UserProfile>>;
  getUserById(emp_id: string): Promise<UserProfile | null>;
  createUser(input: CreateUserInput): Promise<UserProfile>;
  updateUser(emp_id: string, input: UpdateUserInput): Promise<UserProfile>;
  deleteUser(emp_id: string): Promise<void>;
}
