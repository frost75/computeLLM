import { Router } from "express";
import { createHash } from "crypto";
const router: Router = Router();
router.get("/images/:id", async (req: any, res) => {
  const { data, error } = await req.supabase
    .from("refund_case_images")
    .select("data_url,receipt")
    .eq("image_id", req.params.id)
    .single();
  if (error)
    return res.status(404).json({ success: false, error: "截图未找到" });
  res.json({ success: true, data });
});
router.put("/images/:id", async (req: any, res) => {
  try {
    const { dataUrl } = req.body ?? {};
    if (
      typeof dataUrl !== "string" ||
      dataUrl.length > 15 * 1024 * 1024 ||
      !/^data:image\/(png|jpeg|webp|gif);base64,/.test(dataUrl)
    )
      return res
        .status(400)
        .json({ success: false, error: "截图格式或大小不正确" });
    const receipt = createHash("sha256").update(dataUrl).digest("hex");
    const { error } = await req.supabase
      .from("refund_case_images")
      .upsert(
        {
          corp_id: req.user.corp_id,
          emp_id: req.user.emp_id,
          image_id: req.params.id,
          data_url: dataUrl,
          receipt,
        },
        { onConflict: "corp_id,emp_id,image_id", ignoreDuplicates: true },
      );
    if (error) throw error;
    const { data, error: readError } = await req.supabase
      .from("refund_case_images")
      .select("receipt")
      .eq("image_id", req.params.id)
      .single();
    if (readError || data?.receipt !== receipt)
      return res
        .status(409)
        .json({ success: false, error: "截图标识发生冲突，原图已保留" });
    res.json({ success: true, data: { receipt } });
  } catch {
    res.status(500).json({ success: false, error: "云端截图保存失败" });
  }
});
router.get("/", async (req: any, res) => {
  try {
    const { data, error } = await req.supabase
      .from("refund_case_archive")
      .select("case_id,case_data,receipt,deleted,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e: any) {
    res
      .status(500)
      .json({
        success: false,
        error: "云端案例库不可用，请检查数据表迁移和访问权限",
        detail: e.code,
      });
  }
});
router.get("/:id", async (req: any, res) => {
  try {
    const { data, error } = await req.supabase
      .from("refund_case_archive")
      .select("case_data,images,receipt,deleted")
      .eq("case_id", req.params.id)
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch {
    res.status(404).json({ success: false, error: "云端案例未找到或无权访问" });
  }
});
router.put("/:id", async (req: any, res) => {
  try {
    const { payload, receipt, previousReceipt } = req.body ?? {};
    if (
      !/^[a-f0-9-]{36}$/i.test(req.params.id) ||
      !payload ||
      typeof payload.deleted !== "boolean" ||
      !payload.images ||
      typeof payload.images !== "object" ||
      (!payload.deleted && payload.caseData?.id !== req.params.id)
    )
      return res.status(400).json({ success: false, error: "案例格式不正确" });
    const computed = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    if (computed !== receipt)
      return res
        .status(400)
        .json({ success: false, error: "记录校验不一致，请重新保存" });
    if (!payload.deleted) {
      const record = payload.caseData;
      if (!record.draft || !Array.isArray(record.revisions))
        throw new Error("invalid");
      const ids = new Set<string>();
      for (const snapshot of [
        record.draft,
        ...record.revisions.map((v: any) => v.snapshot),
      ])
        for (const side of ["original", "current"]) {
          const id = snapshot?.[side]?.imageId;
          if (id) ids.add(id);
        }
      if (ids.size) {
        const { data, error } = await req.supabase
          .from("refund_case_images")
          .select("image_id")
          .in("image_id", [...ids]);
        if (error || data?.length !== ids.size)
          return res
            .status(400)
            .json({ success: false, error: "截图附件尚未完整上传" });
      }
    }
    const { data, error } = await req.supabase.rpc("save_refund_case", {
      p_case_id: req.params.id,
      p_case_data: payload.caseData ?? null,
      p_images: payload.images,
      p_receipt: receipt,
      p_previous_receipt: previousReceipt ?? null,
      p_deleted: payload.deleted,
    });
    if (error) {
      if (error.message?.includes("CASE_CONFLICT"))
        return res
          .status(409)
          .json({
            success: false,
            error:
              "其他窗口已修改此案例，云端版本已保留；请备份当前记录后处理冲突",
          });
      throw error;
    }
    res.json({ success: true, data: { receipt: data } });
  } catch {
    res
      .status(500)
      .json({ success: false, error: "云端保存失败，本机记录将保留并重试" });
  }
});
export default router;
