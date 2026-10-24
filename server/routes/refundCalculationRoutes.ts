import { Router } from 'express';

const router: Router = Router();

// GET /api/refund-calculations - 获取计算记录列表
router.get('/', async (req: any, res) => {
  try {
    const { data, error } = await req.supabase
      .from('refund_calculations_s_720986d7_5')
      .select('*')
      .eq('is_deleted', 'n')
      .or(`corp_id.eq.${req.user.corp_id},corp_id.is.null`)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(error.code === '42501' ? 403 : 500).json({
      success: false,
      error: error.message || 'Failed to fetch refund calculations'
    });
  }
});

// GET /api/refund-calculations/:id - 获取单个计算记录
router.get('/:id(\\d+)', async (req: any, res) => {
  try {
    const { data, error } = await req.supabase
      .from('refund_calculations_s_720986d7_5')
      .select('*')
      .eq('id', req.params.id)
      .eq('is_deleted', 'n')
      .or(`corp_id.eq.${req.user.corp_id},corp_id.is.null`)
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(error.code === '42501' ? 403 : 500).json({
      success: false,
      error: error.message || 'Failed to fetch refund calculation'
    });
  }
});

// POST /api/refund-calculations - 创建新的计算记录
router.post('/', async (req: any, res) => {
  try {
    const { data, error } = await req.supabase
      .from('refund_calculations_s_720986d7_5')
      .insert([{
        ...req.body,
        corp_id: req.user.corp_id,
        emp_id: req.user.emp_id
      }])
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create refund calculation'
    });
  }
});

// PUT /api/refund-calculations/:id - 更新计算记录
router.put('/:id', async (req: any, res) => {
  try {
    const { data, error } = await req.supabase
      .from('refund_calculations_s_720986d7_5')
      .update({
        ...req.body,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('corp_id', req.user.corp_id)
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, error: 'Record not found or no permission' });
    }
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update refund calculation'
    });
  }
});

// DELETE /api/refund-calculations/:id - 软删除计算记录
router.delete('/:id', async (req: any, res) => {
  try {
    const { error } = await req.supabase
      .from('refund_calculations_s_720986d7_5')
      .update({ is_deleted: 'y', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('corp_id', req.user.corp_id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete refund calculation'
    });
  }
});

// GET /api/refund-calculations/stats - 获取使用统计
router.get('/stats', async (req: any, res) => {
  try {
    // 获取总记录数
    const { count: totalCount, error: countError } = await req.supabase
      .from('refund_calculations_s_720986d7_5')
      .select('*', { count: 'exact', head: true })
      .eq('is_deleted', 'n')
      .or(`corp_id.eq.${req.user.corp_id},corp_id.is.null`);

    if (countError) throw countError;

    // 获取平台分布
    const { data: platformStats, error: platformError } = await req.supabase
      .from('refund_calculations_s_720986d7_5')
      .select('platform')
      .eq('is_deleted', 'n')
      .or(`corp_id.eq.${req.user.corp_id},corp_id.is.null`);

    if (platformError) throw platformError;

    // 获取角色分布
    const { data: roleStats, error: roleError } = await req.supabase
      .from('refund_calculations_s_720986d7_5')
      .select('user_role')
      .eq('is_deleted', 'n')
      .or(`corp_id.eq.${req.user.corp_id},corp_id.is.null`);

    if (roleError) throw roleError;

    // 获取最近30天的每日统计
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: dailyStats, error: dailyError } = await req.supabase
      .from('refund_calculations_s_720986d7_5')
      .select('created_at')
      .eq('is_deleted', 'n')
      .or(`corp_id.eq.${req.user.corp_id},corp_id.is.null`)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: true });

    if (dailyError) throw dailyError;

    // 计算平台分布
    const platformDistribution: Record<string, number> = {};
    platformStats?.forEach((record: any) => {
      const platform = record.platform || 'unknown';
      platformDistribution[platform] = (platformDistribution[platform] || 0) + 1;
    });

    // 计算角色分布
    const roleDistribution: Record<string, number> = {};
    roleStats?.forEach((record: any) => {
      const role = record.user_role || 'unknown';
      roleDistribution[role] = (roleDistribution[role] || 0) + 1;
    });

    // 计算每日统计
    const dailyCounts: Record<string, number> = {};
    dailyStats?.forEach((record: any) => {
      const date = new Date(record.created_at).toISOString().split('T')[0];
      dailyCounts[date] = (dailyCounts[date] || 0) + 1;
    });

    // 填充最近30天的数据
    const dailyTrend: Array<{ date: string; count: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      dailyTrend.push({
        date: dateStr,
        count: dailyCounts[dateStr] || 0
      });
    }

    res.json({
      success: true,
      data: {
        totalCount: totalCount || 0,
        platformDistribution,
        roleDistribution,
        dailyTrend
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch statistics'
    });
  }
});

export default router;
