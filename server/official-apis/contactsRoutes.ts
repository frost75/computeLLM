import { Router } from 'express';
import { createContactsProvider } from '../services/contacts/index.js';
import { EmployeeService } from '../services/employee_service.js';
import { DepartmentService } from '../services/department_service.js';
import type { CreateUserInput, UpdateUserInput } from '../services/contacts/interface.js';

const router: Router = Router();

// Build per-request service instances backed by the active contacts provider.
// To switch providers, edit server/services/contacts/index.ts.
function buildServices(req: any) {
  const provider = createContactsProvider(req);
  return {
    employeeService: new EmployeeService(provider),
    departmentService: new DepartmentService(provider),
  };
}

// ---- Employee routes ----

router.get('/employees/search', async (req: any, res) => {
  try {
    const { query, offset, limit } = req.query;
    const { employeeService } = buildServices(req);
    const result = await employeeService.search({
      query: (query as string) || '',
      offset: offset ? parseInt(offset as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to search employees' });
  }
});

//current login user
router.get('/employees/login/user', async (req: any, res): Promise<void> => {
  try {
    const user = req.user;
    if (!user || !user.isAuthenticated) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // 追一次 getEmployeeById 把归属部门补到响应里；查询失败不阻塞登录态返回
    let dept_list: { dept_id: string; name: string }[] = [];
    if (user.emp_id) {
      try {
        const { employeeService } = buildServices(req);
        const employee = await employeeService.getById(user.emp_id);
        if (employee) {
          dept_list = employee.dept_list || [];
        }
      } catch (deptErr) {
        // 失败仅记录，不影响 login/user 主流程
        console.warn('[employees/login/user] fetch dept info failed:', deptErr);
      }
    }

    res.json({
      success: true,
      data: {
        emp_id: user.emp_id,
        corp_id: user.corp_id,
        corp_name: user.corp_name,
        name: user.name,
        avatar: user.avatar,
        app_id: user.app_id,
        dept_list,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to get current user' });
  }
});

router.get('/employees/:id', async (req: any, res): Promise<void> => {
  try {
    const { employeeService } = buildServices(req);
    const employee = await employeeService.getById(req.params.id);
    if (!employee) {
      res.status(404).json({ success: false, error: 'Employee not found' });
      return;
    }
    res.json({ success: true, data: employee });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to get employee' });
  }
});


// ---- User management routes (Supabase only) ----
// Note: These routes throw 501 when DingtalkContactsProvider is active.

router.get('/users', async (req: any, res) => {
  try {
    const { offset, limit } = req.query;
    const provider = createContactsProvider(req);
    const result = await provider.listUsers(
      offset ? parseInt(offset as string) : undefined,
      limit ? parseInt(limit as string) : undefined,
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message?.includes('not supported') ? 501 : 500;
    res.status(status).json({ success: false, error: error.message || 'Failed to list users' });
  }
});

router.get('/users/:id', async (req: any, res): Promise<void> => {
  try {
    const provider = createContactsProvider(req);
    const user = await provider.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    res.json({ success: true, data: user });
  } catch (error: any) {
    const status = error.message?.includes('not supported') ? 501 : 500;
    res.status(status).json({ success: false, error: error.message || 'Failed to get user' });
  }
});

router.post('/users', async (req: any, res): Promise<void> => {
  try {
    const input: CreateUserInput = req.body;
    if (!input.email || !input.password || !input.name) {
      res.status(400).json({ success: false, error: 'email, password and name are required' });
      return;
    }
    // Inherit corp_id from authenticated user if not provided
    if (!input.corp_id) input.corp_id = req.user.corp_id;
    const provider = createContactsProvider(req);
    const user = await provider.createUser(input);
    res.status(201).json({ success: true, data: user });
  } catch (error: any) {
    const status = error.message?.includes('not supported') ? 501 : 500;
    res.status(status).json({ success: false, error: error.message || 'Failed to create user' });
  }
});

router.put('/users/:id', async (req: any, res) => {
  try {
    const input: UpdateUserInput = req.body;
    const provider = createContactsProvider(req);
    const user = await provider.updateUser(req.params.id, input);
    res.json({ success: true, data: user });
  } catch (error: any) {
    const status = error.message?.includes('not supported') ? 501 : 500;
    res.status(status).json({ success: false, error: error.message || 'Failed to update user' });
  }
});

router.delete('/users/:id', async (req: any, res) => {
  try {
    const provider = createContactsProvider(req);
    await provider.deleteUser(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    const status = error.message?.includes('not supported') ? 501 : 500;
    res.status(status).json({ success: false, error: error.message || 'Failed to delete user' });
  }
});

export default router;
