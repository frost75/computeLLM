import { IContactsProvider, Employee, SearchResult } from './contacts/interface.js';

export type { Employee, SearchResult };

export class EmployeeService {
  constructor(private provider: IContactsProvider) {}

  search(params: { query: string; offset?: number; limit?: number }): Promise<SearchResult<Employee>> {
    return this.provider.searchEmployees(params.query, params.offset, params.limit);
  }

  getById(emp_id: string): Promise<Employee | null> {
    return this.provider.getEmployeeById(emp_id);
  }

  listByDepartment(dept_id: string, offset?: number, limit?: number): Promise<SearchResult<Employee>> {
    return this.provider.listEmployeesByDept(dept_id, offset, limit);
  }
}
