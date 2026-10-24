/**
 * Example RESTful API route.
 *
 * This file demonstrates how to create a new API route in this project.
 * Copy this file and modify it to create your own routes.
 *
 * Steps to add a new route:
 *   1. Create a new file in this directory (e.g. `todoRoutes.ts`)
 *   2. Define your routes using Express Router
 *   3. Register it in `server/index.ts`:
 *        import bookRoutes from './routes/bookRoutes.js';
 *        app.use('/api/books', bookRoutes);
 *
 * Notes:
 *   - All routes under /api are protected by the `need_login` middleware,
 *     so `req.user` (UserContext) and `req.supabase` (authenticated Supabase client)
 *     are available in every handler.
 *   - Use `req.supabase` to interact with Supabase (database, storage, etc.)
 */
import { Router } from 'express';

const router: Router = Router();

/**
 * GET /api/books
 * List all books for the current user.
 */
router.get('/', async (req: any, res: any) => {
  try {
    const { data, error } = await req.supabase
      .from('books')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/books/:id
 * Get a single book by ID.
 */
router.get('/:id', async (req: any, res: any) => {
  try {
    const { data, error } = await req.supabase
      .from('books')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/books
 * Create a new book.
 * Body: { title: string, author: string }
 */
router.post('/', async (req: any, res: any) => {
  try {
    const { title, author } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'title is required' });

    const { data, error } = await req.supabase
      .from('books')
      .insert({ title, author, user_id: req.user.emp_id })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/books/:id
 * Update a book by ID.
 * Body: { title?: string, author?: string }
 */
router.put('/:id', async (req: any, res: any) => {
  try {
    const { title, author } = req.body;
    const { data, error } = await req.supabase
      .from('books')
      .update({ title, author })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/books/:id
 * Delete a book by ID.
 */
router.delete('/:id', async (req: any, res: any) => {
  try {
    const { error } = await req.supabase
      .from('books')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true, data: null });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
