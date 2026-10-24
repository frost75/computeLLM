import { IContactsProvider, Department, DepartmentTreeResult, DeptSearchResult } from './contacts/interface.js';

export type { Department, DepartmentTreeResult, DeptSearchResult };

export class DepartmentService {
  constructor(private provider: IContactsProvider) {}

  list(parent_id?: string): Promise<Department[]> {
    return this.provider.listDepartments(parent_id);
  }

  getTree(deptId?: string): Promise<DepartmentTreeResult> {
    return this.provider.getDepartmentTree(deptId);
  }

  getById(dept_id: string): Promise<Department | null> {
    return this.provider.getDepartmentById(dept_id);
  }

  search(key: string, offset?: number, limit?: number): Promise<DeptSearchResult> {
    return this.provider.searchDepts(key, offset, limit);
  }
}
