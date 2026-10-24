import { useState, useEffect, useMemo } from "react";
import { newCase, type CaseFile, type Snapshot } from "./domain/contracts";
import { evaluate } from "./domain/rules";
import OrderPanel from "./components/OrderPanel";
import CaseChatPanel from "./components/CaseChatPanel";
import { yuan } from "./domain/money";
import { recognize } from "./services/recognition";
import { repository } from "./services/cases";
import { cloudLoginUrl } from "./services/cloud";
import { CaseWorkspace } from "./services/caseWorkspace";
const workspace = new CaseWorkspace(repository, recognize);
export default function Workbench() {
  const [activeId, setActiveId] = useState(""),
    [tick, setTick] = useState(0),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [historyId, setHistoryId] = useState<string | null>(null),
    [chatOpen, setChatOpen] = useState<Record<string, boolean>>({});
  useEffect(() => workspace.subscribe(() => setTick((v) => v + 1)), []);
  useEffect(
    () =>
      repository.subscribe((id) => {
        setTick((v) => v + 1);
        if (id === "__refresh__")
          void repository
            .list()
            .then((list) => workspace.seed(list))
            .catch((e) => setError(String(e)));
      }),
    [],
  );
  useEffect(() => {
    let live = true;
    repository
      .list()
      .then((list) => {
        if (!live) return;
        workspace.seed(list);
        const first =
          workspace.list().find((c) => c.draft.platform === "jd") ??
          workspace.add(newCase());
        setActiveId(first.id);
      })
      .catch((e) => setError(String(e)));
    return () => {
      live = false;
    };
  }, []);
  void tick;
  const record = workspace.get(activeId),
    cases = workspace.list().filter((c) => c.draft.platform === "jd");
  const activity = workspace.activity(activeId),
    busy = { original: !!activity.original, current: !!activity.current };
  const historical =
    record?.revisions.find(
      (r) => r.id === historyId && r.snapshot.platform === "jd",
    )?.snapshot ?? null;
  const snapshot = historical ?? record?.draft;
  const saveState = record ? repository.status(record.id) : "";
  const review = snapshot?.aiReview;
  const reviewWarnings =
    review?.status === "stale" ? [] : (review?.warnings ?? []).slice(0, 3);
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
  function setHistorical(value: Snapshot | null) {
    setHistoryId(
      value
        ? (record?.revisions.find((r) => r.snapshot === value)?.id ?? null)
        : null,
    );
  }
  function update(patch: Partial<Snapshot>) {
    if (record) workspace.change(record.id, patch);
  }
  function cancelRecognition(side?: "original" | "current") {
    if (record) workspace.cancel(record.id, side);
  }
  function swapOrders() {
    if (record && !historical) {
      setError("");
      workspace.swap(record.id);
    }
  }
  async function navigate(next: CaseFile) {
    if (!workspace.get(next.id)) workspace.add(next);
    setActiveId(next.id);
    setHistoryId(null);
    setError("");
  }
  async function upload(side: "original" | "current", file: File) {
    if (record) await workspace.upload(record.id, side, file);
  }
  if (!record || !snapshot)
    return <main>{error || "正在打开本机案例库…"}</main>;
  const result = historical?.result ?? evaluation.result;
  const threadKey = historyId ?? "draft";
  const chatKey = `${record.id}:${threadKey}`;
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
              <small>
                {c.revisions.length} 个修订 ·{" "}
                {workspace.activity(c.id).review
                  ? "处理中"
                  : workspace.activity(c.id).original ||
                      workspace.activity(c.id).current
                    ? "识别中"
                    : c.draft.aiReview?.status === "done"
                      ? "已完成"
                      : c.draft.aiReview?.status === "failed"
                        ? ""
                        : ""}
              </small>
            </button>
          ))}
      </aside>
      <main>
        <header>
          <div>
            <h1>京东退差计算器</h1>
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
                try {
                  await workspace.remove(record.id);
                  const next =
                    workspace.list().find((c) => c.draft.platform === "jd") ??
                    workspace.add(newCase());
                  setActiveId(next.id);
                  setHistorical(null);
                } catch (e) {
                  setError(`删除失败，案例已保留：${String(e)}`);
                }
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
            workspace.mutate(
              record.id,
              (r) => ({ ...r, title: e.target.value }),
              false,
            )
          }
        />
        <nav>
          <span className="entry-badge">京东自营 / POP</span>
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
              {record.revisions
                .filter((v) => v.snapshot.platform === "jd")
                .map((v, i) => (
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
                workspace.mutate(record.id, (r) => ({
                  ...r,
                  draft: { ...structuredClone(historical), result: null },
                  baseRevision: revision?.id ?? null,
                }));
                setHistorical(null);
              }}
            >
              从此修订继续修改
            </button>
          )}
        </nav>
        {!!(error || activity.errors?.length) && (
          <div role="alert" className="error">
            {error || activity.errors?.join("；")}
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
                reviewWarnings={reviewWarnings.filter((w) => w.side === side)}
                reviewed={review?.status === "done"}
                readOnly={!!historical}
                cancel={() => cancelRecognition(side)}
              />
            ))}
          </div>
        </div>
        {!historical && (
          <div className="recognition-retry">
            {(["original", "current"] as const).map(
              (side) =>
                snapshot[side].recognitionError &&
                !busy[side] && (
                  <button
                    key={side}
                    onClick={() =>
                      void workspace.recognizeSide(record.id, side)
                    }
                  >
                    重试{side === "original" ? "原订单" : "现订单"}识别
                  </button>
                ),
            )}
          </div>
        )}
        {reviewWarnings.length > 0 && (
          <details className="ai-notes">
            <summary>AI提示（{reviewWarnings.length}）</summary>
            {reviewWarnings.map((w, i) => (
              <p key={i}>
                {w.side === "original"
                  ? "原订单："
                  : w.side === "current"
                    ? "现订单："
                    : ""}
                {w.message}
              </p>
            ))}
          </details>
        )}
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
              <div
                className={`result-amounts ${snapshot.platform === "jd" ? "single" : ""}`}
              >
                <div>
                  <span>
                    {snapshot.platform === "jd" ? "可退差价" : "基础退差"}
                  </span>
                  <strong>¥{yuan(result.base)}</strong>
                </div>
                {snapshot.platform !== "jd" && (
                  <>
                    <div>
                      <span>额外关怀参考</span>
                      <strong>
                        {result.extra === null
                          ? "待确认"
                          : `¥${yuan(result.extra)}`}
                      </strong>
                    </div>
                    <div>
                      <span>含关怀合计</span>
                      <strong>
                        {result.total === null
                          ? "待确认"
                          : `¥${yuan(result.total)}`}
                      </strong>
                    </div>
                  </>
                )}
              </div>
              <p className="hint">
                {snapshot.platform === "jd"
                  ? "仅计算商家承担的优惠差额，平台承担部分不退。"
                  : "额外关怀及合计供客服评估方案，需确认采用后再告知用户。"}
              </p>
              <div className="customer">
                <strong>可发送给用户</strong>
                <p>{result.customerText}</p>
                <div className="customer-actions">
                  <button
                    onClick={() =>
                      navigator.clipboard
                        .writeText(result.customerText)
                        .catch(() => setError("复制失败，请手动选取话术复制"))
                    }
                  >
                    复制用户话术
                  </button>
                  <button
                    className="ask-ai"
                    aria-expanded={!!chatOpen[chatKey]}
                    onClick={() =>
                      setChatOpen((previous) => ({
                        ...previous,
                        [chatKey]: !previous[chatKey],
                      }))
                    }
                  >
                    有疑问？问AI
                  </button>
                </div>
                {chatOpen[chatKey] && (
                  <CaseChatPanel
                    key={chatKey}
                    thread={record.chatThreads?.[threadKey]}
                    busy={workspace.chatBusy(record.id, threadKey)}
                    onSend={(question) =>
                      void workspace.ask(
                        record.id,
                        threadKey,
                        { ...snapshot, result },
                        question,
                      )
                    }
                    onRetry={() =>
                      void workspace.ask(record.id, threadKey, {
                        ...snapshot,
                        result,
                      })
                    }
                  />
                )}
              </div>
              <details>
                <summary>金额说明</summary>

                {Object.entries(result.basis).map(([k, v]) => (
                  <p key={k}>
                    {snapshot.platform === "jd" &&
                    ["原订单优惠", "现订单优惠", "优惠差额"].includes(k)
                      ? k.replace("优惠", "商家优惠")
                      : k}
                    ：{v === null ? "待确认" : `${yuan(v)}元`}
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
