import { useState, useEffect, useMemo, useRef } from "react";
import {
  newCase,
  newOrder,
  type CaseFile,
  type Snapshot,
} from "./domain/contracts";
import { evaluate } from "./domain/rules";
import OrderPanel from "./components/OrderPanel";
import { automaticOrder } from "./domain/automation";
import { yuan } from "./domain/money";
import { recognize } from "./services/recognition";
import { repository } from "./services/cases";
import { cloudLoginUrl } from "./services/cloud";

export default function Workbench() {
  const [record, setRecord] = useState<CaseFile | null>(null),
    [cases, setCases] = useState<CaseFile[]>([]),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<Record<string, boolean>>({}),
    [historical, setHistorical] = useState<Snapshot | null>(null),
    [saveState, setSaveState] = useState("");
  const active = useRef(record);
  active.current = record;
  const requests = useRef<Record<string, AbortController>>({}),
    serial = useRef<Record<string, string>>({});
  function finalized(r: CaseFile): CaseFile {
    const evaluated = evaluate(r.draft);
    if (!evaluated.result) return r;
    const snap = { ...r.draft, result: evaluated.result };
    const previous = r.revisions.find((v) => v.id === r.baseRevision);
    if (previous && JSON.stringify(previous.snapshot) === JSON.stringify(snap))
      return r;
    const rev = {
      id: crypto.randomUUID(),
      parentId: r.baseRevision,
      time: new Date().toISOString(),
      snapshot: structuredClone(snap),
    };
    return {
      ...r,
      draft: snap,
      baseRevision: rev.id,
      revisions: [...r.revisions, rev],
    };
  }
  const refresh = async () =>
    setCases(
      (await repository.list()).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    );
  useEffect(
    () =>
      repository.subscribe((id, message) => {
        if (id === "__refresh__") void refresh();
        else if (active.current?.id === id) setSaveState(message);
      }),
    [],
  );
  useEffect(() => {
    let live = true;
    repository
      .list()
      .then(async (list) => {
        if (!live) return;
        const first =
          list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
          newCase();
        if (!list.length) await repository.save(first);
        setCases(list.length ? list : [first]);
        setRecord(first);
      })
      .catch((e) => setError(String(e)));
    return () => {
      live = false;
      Object.values(requests.current).forEach((r) => r.abort());
    };
  }, []);
  const snapshot = historical ?? record?.draft;
  const evaluation = useMemo(
    () =>
      snapshot
        ? !snapshot.original.imageId || !snapshot.current.imageId
          ? {
              result: null,
              issues: [
                !snapshot.original.imageId
                  ? "请上传原订单截图"
                  : "请上传现订单截图",
              ],
            }
          : evaluate(snapshot)
        : { result: null, issues: [] },
    [snapshot],
  );
  useEffect(() => {
    if (!record) return;
    setSaveState("保存中…");
    const t = setTimeout(() => {
      repository
        .save(record)
        .then(() => {
          setSaveState(repository.status(record.id));
          return refresh();
        })
        .catch((e) => {
          setSaveState("保存失败");
          setError(String(e));
        });
    }, 250);
    return () => clearTimeout(t);
  }, [record]);
  useEffect(() => {
    if (
      !record ||
      historical ||
      !evaluation.result ||
      Object.values(busy).some(Boolean)
    )
      return;
    const t = setTimeout(
      () =>
        setRecord((prev) => {
          if (!prev || prev.id !== record.id) return prev;
          const snap = { ...prev.draft, result: evaluation.result };
          const last = prev.revisions.find((r) => r.id === prev.baseRevision);
          if (last && JSON.stringify(last.snapshot) === JSON.stringify(snap))
            return prev;
          const revision = {
            id: crypto.randomUUID(),
            parentId: prev.baseRevision,
            time: new Date().toISOString(),
            snapshot: structuredClone(snap),
          };
          return {
            ...prev,
            draft: snap,
            revisions: [...prev.revisions, revision],
            baseRevision: revision.id,
            updatedAt: new Date().toISOString(),
          };
        }),
      900,
    );
    return () => clearTimeout(t);
  }, [record, evaluation.result, busy, historical]);
  function update(patch: Partial<Snapshot>) {
    setRecord((prev) =>
      prev
        ? {
            ...prev,
            updatedAt: new Date().toISOString(),
            draft: { ...prev.draft, ...patch, result: null },
          }
        : prev,
    );
  }
  function cancelRecognition(side?: "original" | "current") {
    const sides = side ? [side] : ["original", "current"];
    for (const key of sides) {
      // Invalidate first: an aborted request can still finish file IO or hit cache.
      delete serial.current[key];
      requests.current[key]?.abort();
      delete requests.current[key];
    }
    setBusy((v) => side ? { ...v, [side]: false } : {});
  }
  function swapOrders() {
    if (historical) return;
    cancelRecognition();
    setError("");
    setRecord((prev) => {
      if (!prev) return prev;
      // Preserve even an incomplete draft, so the exchange is always reversible.
      const before = {
        id: crypto.randomUUID(),
        parentId: prev.baseRevision,
        time: new Date().toISOString(),
        snapshot: structuredClone(prev.draft),
      };
      const swapped: Snapshot = {
        ...prev.draft,
        original: structuredClone(prev.draft.current),
        current: structuredClone(prev.draft.original),
        comparisonConfirmed: false,
        result: null,
      };
      swapped.result = evaluate(swapped).result;
      const after = {
        id: crypto.randomUUID(),
        parentId: before.id,
        time: new Date().toISOString(),
        snapshot: structuredClone(swapped),
      };
      return {
        ...prev,
        draft: swapped,
        updatedAt: after.time,
        baseRevision: after.id,
        revisions: [...prev.revisions, before, after],
      };
    });
  }
  async function navigate(next: CaseFile) {
    if (next.id === active.current?.id) {
      setHistorical(null);
      return;
    }
    Object.values(requests.current).forEach((r) => r.abort());
    serial.current = {};
    setBusy({});
    if (active.current) await repository.save(finalized(active.current));
    setHistorical(null);
    setRecord(next);
    setError("");
  }
  async function upload(side: "original" | "current", file: File) {
    if (!record) return;
    const id = record.id,
      platform = record.draft.platform,
      token = crypto.randomUUID();
    serial.current[side] = token;
    requests.current[side]?.abort();
    const controller = new AbortController();
    requests.current[side] = controller;
    setBusy((v) => ({ ...v, [side]: true }));
    setError("");
    try {
      if (
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
          file.type,
        ) ||
        file.size > 10 * 1024 * 1024
      )
        throw new Error("请选择10MB以内的图片");
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("图片读取失败"));
        r.readAsDataURL(file);
      });
      const imageId = crypto.randomUUID();
      await repository.putImage(imageId, data);
      if (active.current?.id !== id || serial.current[side] !== token) return;
      const fresh = { ...newOrder(), imageId };
      setRecord((p) =>
        p && p.id === id && serial.current[side] === token
          ? { ...p, draft: { ...p.draft, [side]: fresh, result: null } }
          : p,
      );
      const recognition = await recognize(
        data,
        platform,
        side,
        controller.signal,
      );
      if (active.current?.id !== id || serial.current[side] !== token) return;
      setRecord((p) =>
        p && p.id === id && serial.current[side] === token
          ? {
              ...p,
              draft: {
                ...p.draft,
                [side]: automaticOrder(recognition, imageId, side, platform),
                result: null,
              },
            }
          : p,
      );
    } catch (e) {
      if (active.current?.id === id && serial.current[side] === token) {
        setError(
          `${side === "original" ? "原订单" : "现订单"}：${(e as Error).message}。可重新上传该图重试或手动填写。`,
        );
        setRecord((p) =>
          p && p.id === id && serial.current[side] === token
            ? {
                ...p,
                draft: {
                  ...p.draft,
                  [side]: {
                    ...p.draft[side],
                    recognitionError: (e as Error).message,
                  },
                },
              }
            : p,
        );
      }
    } finally {
      if (serial.current[side] === token)
        setBusy((v) => ({ ...v, [side]: false }));
    }
  }
  if (!record || !snapshot)
    return <main>{error || "正在打开本机案例库…"}</main>;
  const result = historical?.result ?? evaluation.result;
  return (
    <div className="workbench">
      <aside>
        <h1>退差工作台</h1>
        <button onClick={() => navigate(newCase())}>＋ 新建案例</button>
        <input
          placeholder="搜索案例标题"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {cases
          .filter((c) => c.title.includes(search))
          .map((c) => (
            <button
              className={c.id === record.id ? "active case" : "case"}
              key={c.id}
              onClick={() => navigate(c)}
            >
              {c.title}
              <small>{c.revisions.length} 个修订</small>
            </button>
          ))}
      </aside>
      <main>
        <header>
          <div>
            <h1>{snapshot.platform === "jd" ? "京东" : "天猫"}退差计算器</h1>
            <span className="hint">{saveState}</span>
            {saveState.includes("待同步") && (
              <button
                className="sync-retry"
                onClick={() => {
                  const login = cloudLoginUrl();
                  if (saveState.includes("登录") && login)
                    window.location.assign(login);
                  else void repository.retry();
                }}
              >
                {saveState.includes("登录") ? "登录后同步" : "重试同步"}
              </button>
            )}
          </div>
          <button
            onClick={async () => {
              if (window.confirm("删除本案例及全部修订？")) {
                Object.values(requests.current).forEach((r) => r.abort());
                serial.current = {};
                setRecord(null);
                active.current = null;
                await repository.remove(record.id);
                setCases(await repository.list());
                setRecord(newCase());
                setHistorical(null);
                setBusy({});
              }
            }}
          >
            删除案例
          </button>
        </header>
        <input
          className="title"
          aria-label="案例标题"
          value={record.title}
          onChange={(e) =>
            setRecord({
              ...record,
              title: e.target.value,
              updatedAt: new Date().toISOString(),
            })
          }
        />
        <nav>
          <label>
            入口
            <select
              disabled={!!historical || Object.values(busy).some(Boolean)}
              value={snapshot.platform}
              onChange={(e) => {
                if (window.confirm("切换入口将清空当前草稿，历史修订保留。"))
                  update({
                    platform: e.target.value as Snapshot["platform"],
                    original: newOrder(),
                    current: newOrder(),
                    comparisonConfirmed: false,
                  });
              }}
            >
              <option value="jd">京东自营 / POP</option>
              <option value="tmall">天猫</option>
            </select>
          </label>
          <label>
            岗位
            <select
              disabled={!!historical}
              value={snapshot.role}
              onChange={(e) =>
                update({ role: e.target.value as Snapshot["role"] })
              }
            >
              <option value="member">组员</option>
              <option value="leader">组长</option>
            </select>
          </label>
          <label>
            历史
            <select
              value={
                historical
                  ? (record.revisions.find((r) => r.snapshot === historical)
                      ?.id ?? "")
                  : "draft"
              }
              onChange={(e) =>
                setHistorical(
                  record.revisions.find((r) => r.id === e.target.value)
                    ?.snapshot ?? null,
                )
              }
            >
              <option value="draft">当前草稿</option>
              {record.revisions.map((v, i) => (
                <option key={v.id} value={v.id}>
                  修订{i + 1} · {new Date(v.time).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          {historical && (
            <button
              onClick={() => {
                cancelRecognition();
                const revision = record.revisions.find(
                  (r) => r.snapshot === historical,
                );
                setRecord({
                  ...record,
                  draft: { ...structuredClone(historical), result: null },
                  baseRevision: revision?.id ?? null,
                });
                setHistorical(null);
              }}
            >
              从此修订继续修改
            </button>
          )}
        </nav>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <div>
          <div className="orders-toolbar">
            <p>现订单按付款后的金额比较，无需实际付款。</p>
            <button type="button" disabled={!!historical} onClick={swapOrders}>
              ⇄ 交换原订单与现订单
            </button>
          </div>
          <div className="orders">
            {(["original", "current"] as const).map((side) => (
              <OrderPanel
                key={`${record.id}-${side}-${historical ? "history" : "draft"}`}
                title={side === "original" ? "原订单" : "现订单"}
                platform={snapshot.platform}
                order={snapshot[side]}
                change={(o) => update({ [side]: o })}
                upload={(f) => upload(side, f)}
                busy={!!busy[side]}
                readOnly={!!historical}
                cancel={() => cancelRecognition(side)}
              />
            ))}
          </div>
        </div>
        <section className="result">
          <h2>{historical ? "历史结果（保留当时版本）" : "退差结果"}</h2>
          {!result ? (
            <div className="pending">
              {evaluation.issues.map((v) => (
                <p key={v}>{v}</p>
              ))}
              <p>
                {Object.values(busy).some(Boolean)
                  ? "正在识别，完成后自动计算…"
                  : "上传两张完整订单截图后自动计算；缺少关键金额时可展开校正。"}
              </p>
            </div>
          ) : (
            <>
              <div className="result-amounts">
                <div><span>基础退差</span><strong>¥{yuan(result.base)}</strong></div>
                <div><span>额外关怀参考</span><strong>{result.extra === null ? "待确认" : `¥${yuan(result.extra)}`}</strong></div>
                <div><span>含关怀合计</span><strong>{result.total === null ? "待确认" : `¥${yuan(result.total)}`}</strong></div>
              </div>
              <p className="hint">额外关怀及合计供客服评估方案，需确认采用后再告知用户。</p>
              <div className="customer">
                <strong>可发送给用户</strong>
                <p>{result.customerText}</p>
                <button
                  onClick={() =>
                    navigator.clipboard
                      .writeText(result.customerText)
                      .catch(() => setError("复制失败，请手动选取话术复制"))
                  }
                >
                  复制用户话术
                </button>
              </div>
              <details>
                <summary>客服处理建议与关怀方案</summary>
                {result.internal.map((v) => (
                  <p key={v}>{v}</p>
                ))}
                {result.careText && (
                  <>
                    <p>确认采用关怀方案后可发送：</p>
                    <blockquote>{result.careText}</blockquote>
                    <button
                      onClick={() =>
                        navigator.clipboard
                          .writeText(result.careText!)
                          .catch(() => setError("复制失败，请手动复制"))
                      }
                    >
                      复制关怀话术
                    </button>
                  </>
                )}
              </details>
              <details>
                <summary>金额说明</summary>

                {Object.entries(result.basis).map(([k, v]) => (
                  <p key={k}>
                    {k}：{v === null ? "待确认" : `${yuan(v)}元`}
                  </p>
                ))}
              </details>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
