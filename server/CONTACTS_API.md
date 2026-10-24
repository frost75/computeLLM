# Contacts API Reference

All routes are mounted under `/api/contacts` and require `Authorization: Bearer <token>`.

All responses follow `{ success: boolean, data?: any, error?: string }`.

---

## Employee

### Search employees
```
GET /api/contacts/employees/search?q=<keyword>&offset=<n>&limit=<n>
```
Response `data`: `{ items: Employee[], total, offset, has_more }`

### Get employee by ID
```
GET /api/contacts/employees/:emp_id
```
Response `data`: `Employee | null` (404 if not found)

---

## User Management (Supabase provider only)

### List users
```
GET /api/contacts/users?offset=<n>&limit=<n>
```

### Get user by ID
```
GET /api/contacts/users/:emp_id
```

### Create user
```
POST /api/contacts/users
Body: { email, password, name, corp_id, role?, title?, job_number?, dept_id_list?, mobile? }
```

### Update user
```
PUT /api/contacts/users/:emp_id
Body: { name?, avatar?, email?, mobile?, title?, job_number?, dept_id_list?, role?, is_active? }
```

### Delete user
```
DELETE /api/contacts/users/:emp_id
```

---

## Data Types

```ts
interface Employee {
  emp_id: string;
  name: string;
  avatar: string | null;
  dept_id_list: string[];
  mobile?: string;
  email?: string;
  title?: string;
  job_number?: string;
}
```
