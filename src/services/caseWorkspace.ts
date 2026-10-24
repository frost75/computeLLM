import {
  FIELD_LABELS,
  newOrder,
  type CaseFile,
  type Snapshot,
  type Field,
} from "../domain/contracts";
import { evaluate } from "../domain/rules";
import { automaticOrder } from "../domain/automation";
import { materializeSnapshot } from "../domain/settlement";
import type { Recognition } from "../domain/contracts";
import { reviewCase, applyReview } from "./aiReview";
import { answerCaseQuestion, createCaseChatContext } from "./caseChat";
type Side = "original" | "current";
type Repository = {
  save(r: CaseFile): Promise<unknown>;
  image(id: string): Promise<string | undefined>;
  putImage(id: string, data: string): Promise<unknown>;
  remove(id: string): Promise<unknown>;
};
type Job = {
  token: string;
  controller: AbortController;
  started: number;
  file?: File;
};
export type CaseActivity = {
  original?: Job;
  current?: Job;
  review?: Job;
  errors?: string[];
  recognitionMs?: Partial<Record<Side, number>>;
};
const signature = (s: Snapshot) =>
  JSON.stringify({ ...s, result: null, aiReview: undefined });
// Jobs belong to case identity, never to the currently selected React panel.
export class CaseWorkspace {
  records = new Map<string, CaseFile>();
  activities = new Map<string, CaseActivity>();
  private listeners = new Set<() => void>();
  private chatRequests = new Map<string, Job>();
  constructor(
    private repo: Repository,
    private recognize: (
      data: string,
      platform: string,
      side: string,
      signal: AbortSignal,
    ) => Promise<Recognition>,
    private reviewer = reviewCase,
    private chatAnswer = answerCaseQuestion,
  ) {}
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  seed(records: CaseFile[]) {
    for (const r of records) {
      const local = this.get(r.id),
        s = this.activity(r.id);
      if (
        !local ||
        (!s.original &&
          !s.current &&
          !s.review &&
          !this.caseChatBusy(r.id) &&
          r.updatedAt > local.updatedAt)
      ) {
        const draft = materializeSnapshot(r.draft);
        if (
          draft.aiReview &&
          (JSON.stringify(draft.original.calculated) !==
            JSON.stringify(r.draft.original.calculated) ||
            JSON.stringify(draft.current.calculated) !==
              JSON.stringify(r.draft.current.calculated) ||
            r.draft.result?.ruleVersion !== evaluate(draft).result?.ruleVersion)
        )
          draft.aiReview = { ...draft.aiReview, status: "stale" };
        this.records.set(r.id, { ...r, draft });
      }
    }
    this.emit();
  }
  get(id: string) {
    return this.records.get(id);
  }
  list() {
    return [...this.records.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }
  activity(id: string) {
    return this.activities.get(id) ?? {};
  }
  chatBusy(id: string, threadKey: string) {
    return this.chatRequests.has(`${id}:${threadKey}`);
  }
  caseChatBusy(id: string) {
    return [...this.chatRequests.keys()].some((key) =>
      key.startsWith(`${id}:`),
    );
  }
  async ask(
    id: string,
    threadKey: string,
    snapshot: Snapshot,
    question?: string,
  ) {
    const record = this.get(id),
      key = `${id}:${threadKey}`;
    if (!record || this.chatRequests.has(key)) return;
    const text = question?.trim();
    const previous = record.chatThreads?.[threadKey] ?? { messages: [] };
    if (
      (question !== undefined && !text) ||
      (question === undefined &&
        previous.messages[previous.messages.length - 1]?.role !== "user")
    )
      return;
    const context = createCaseChatContext(snapshot);
    const messages = structuredClone(previous.messages);
    if (text)
      messages.push({
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        time: new Date().toISOString(),
        context,
      });
    else
      messages[messages.length - 1] = {
        ...messages[messages.length - 1],
        context,
      };
    const job = {
      token: crypto.randomUUID(),
      controller: new AbortController(),
      started: performance.now(),
    };
    this.chatRequests.set(key, job);
    this.mutate(
      id,
      (r) => ({
        ...r,
        chatThreads: {
          ...r.chatThreads,
          [threadKey]: { messages, error: undefined },
        },
      }),
      false,
    );
    try {
      const answer = await this.chatAnswer(
        context,
        messages,
        job.controller.signal,
      );
      if (this.chatRequests.get(key) !== job || !this.get(id)) return;
      this.mutate(
        id,
        (r) => ({
          ...r,
          chatThreads: {
            ...r.chatThreads,
            [threadKey]: {
              messages: [
                ...(r.chatThreads?.[threadKey]?.messages ?? messages),
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: answer,
                  time: new Date().toISOString(),
                  context,
                },
              ],
              error: undefined,
            },
          },
        }),
        false,
      );
    } catch (e) {
      if (
        this.chatRequests.get(key) === job &&
        this.get(id) &&
        !job.controller.signal.aborted
      )
        this.mutate(
          id,
          (r) => ({
            ...r,
            chatThreads: {
              ...r.chatThreads,
              [threadKey]: {
                messages: r.chatThreads?.[threadKey]?.messages ?? messages,
                error: (e as Error).message || "回复暂未完成，请重试",
              },
            },
          }),
          false,
        );
    } finally {
      if (this.chatRequests.get(key) === job) {
        this.chatRequests.delete(key);
        this.emit();
      }
    }
  }
  private state(id: string) {
    if (!this.activities.has(id)) this.activities.set(id, {});
    return this.activities.get(id)!;
  }
  private store(r: CaseFile) {
    r = { ...r, draft: materializeSnapshot(r.draft) };
    this.records.set(r.id, r);
    this.emit();
    void this.repo.save(structuredClone(r)).catch((e) => {
      if (this.records.has(r.id)) {
        this.state(idOf(r)).errors = [`保存失败：${String(e)}`];
        this.emit();
      }
    });
    return r;
  }
  add(r: CaseFile) {
    return this.store(r);
  }
  mutate(id: string, fn: (r: CaseFile) => CaseFile, stale = true) {
    const r = this.get(id);
    if (!r) return;
    const changed = fn(structuredClone(r));
    changed.updatedAt = new Date().toISOString();
    if (stale) {
      this.stopReview(id);
      if (changed.draft.aiReview)
        changed.draft.aiReview = { ...changed.draft.aiReview, status: "stale" };
    }
    return this.store(changed);
  }
  change(id: string, patch: Partial<Snapshot>) {
    this.mutate(id, (r) => ({
      ...r,
      draft: { ...r.draft, ...patch, result: null },
    }));
  }
  private revision(r: CaseFile) {
    const snapshot = { ...r.draft, result: evaluate(r.draft).result };
    const previous = r.revisions.find((v) => v.id === r.baseRevision);
    if (
      previous &&
      JSON.stringify(previous.snapshot) === JSON.stringify(snapshot)
    )
      return r;
    const revision = {
      id: crypto.randomUUID(),
      parentId: r.baseRevision,
      time: new Date().toISOString(),
      snapshot: structuredClone(snapshot),
    };
    return {
      ...r,
      draft: snapshot,
      baseRevision: revision.id,
      revisions: [...r.revisions, revision],
    };
  }
  private stopReview(id: string) {
    const s = this.state(id);
    s.review?.controller.abort();
    delete s.review;
  }
  cancel(id: string, side?: Side) {
    const s = this.state(id);
    this.stopReview(id);
    for (const key of side ? [side] : (["original", "current"] as Side[])) {
      s[key]?.controller.abort();
      delete s[key];
    }
    const r = this.get(id);
    if (r?.draft.aiReview?.status === "running")
      this.mutate(
        id,
        (c) => ({
          ...c,
          draft: {
            ...c.draft,
            aiReview: {
              ...c.draft.aiReview!,
              status: "stale",
              summary: "复核已停止，页面变化后可再次点击AI复核。",
            },
          },
        }),
        false,
      );
    this.emit();
  }
  swap(id: string) {
    const original = this.get(id);
    if (!original) return;
    const s = this.state(id),
      restart: { side: Side; file?: File }[] = [];
    if (s.original) restart.push({ side: "current", file: s.original.file });
    if (s.current) restart.push({ side: "original", file: s.current.file });
    this.cancel(id);
    this.mutate(
      id,
      (r) => {
        const before = this.revision(r);
        const old = before.draft;
        return this.revision({
          ...before,
          draft: {
            ...old,
            original: old.current,
            current: old.original,
            result: null,
            comparisonConfirmed: false,
            aiReview: undefined,
          },
        });
      },
      false,
    );
    // Already completed observations move intact. Only unfinished images restart.
    for (const job of restart)
      void (job.file
        ? this.upload(id, job.side, job.file)
        : this.recognizeSide(id, job.side));
    if (!restart.length) void this.review(id, false);
  }
  async upload(id: string, side: Side, file: File) {
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      ) ||
      file.size > 10 * 1024 * 1024
    ) {
      this.state(id).errors = ["请选择10MB以内的图片"];
      this.emit();
      return;
    }
    this.cancel(id, side);
    // Reserve the slot during file reading so a swap cannot strand an image.
    const job = {
      token: crypto.randomUUID(),
      controller: new AbortController(),
      started: performance.now(),
      file,
    };
    this.state(id)[side] = job;
    this.emit();
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("图片读取失败"));
        r.readAsDataURL(file);
      });
      if (this.state(id)[side] !== job || !this.get(id)) return;
      const imageId = crypto.randomUUID();
      await this.repo.putImage(imageId, data);
      if (this.state(id)[side] !== job || !this.get(id)) return;
      delete this.state(id)[side];
      this.mutate(id, (r) => ({
        ...r,
        draft: {
          ...r.draft,
          [side]: { ...newOrder(), imageId },
          result: null,
          aiReview: undefined,
        },
      }));
      await this.recognizeSide(id, side, data);
    } catch (e) {
      if (this.state(id)[side] === job) {
        delete this.state(id)[side];
        this.state(id).errors = [String(e)];
        this.emit();
      }
    }
  }
  async recognizeSide(id: string, side: Side, knownData?: string) {
    const r = this.get(id),
      imageId = r?.draft[side].imageId;
    if (!r || !imageId) return;
    this.cancel(id, side);
    const job = {
      token: crypto.randomUUID(),
      controller: new AbortController(),
      started: performance.now(),
    };
    const state = this.state(id);
    state[side] = job;
    state.errors = [];
    this.emit();
    try {
      const data = knownData ?? (await this.repo.image(imageId));
      if (!data) throw new Error("截图未取回，请重试");
      if (
        this.state(id)[side] !== job ||
        job.controller.signal.aborted ||
        !this.get(id)
      )
        return;
      const recognized = await this.recognize(
        data,
        r.draft.platform,
        side,
        job.controller.signal,
      );
      if (
        this.state(id)[side] !== job ||
        this.get(id)?.draft[side].imageId !== imageId
      )
        return;
      this.mutate(id, (c) => ({
        ...c,
        draft: {
          ...c.draft,
          [side]: {
            ...automaticOrder(recognized, imageId, side, c.draft.platform),
            overrides: c.draft[side].overrides,
          },
          result: null,
        },
      }));
      state.recognitionMs = {
        ...state.recognitionMs,
        [side]: Math.round(performance.now() - job.started),
      };
    } catch (e) {
      if (this.state(id)[side] === job && !job.controller.signal.aborted) {
        const message = (e as Error).message;
        state.errors = [
          `${side === "original" ? "原订单" : "现订单"}：${message}。可点击重试识别，无需重新上传。`,
        ];
        this.mutate(id, (c) => ({
          ...c,
          draft: {
            ...c.draft,
            [side]: { ...c.draft[side], recognitionError: message },
            result: null,
          },
        }));
      }
    } finally {
      if (this.state(id)[side] === job) {
        delete state[side];
        this.emit();
        if (!state.original && !state.current) void this.review(id, false);
      }
    }
  }
  async review(id: string, manual = true) {
    const record = this.get(id),
      state = this.state(id);
    if (!record || state.original || state.current || state.review) return;
    const source = materializeSnapshot(structuredClone(record.draft));
    if (
      !source.original.imageId ||
      !source.current.imageId ||
      (!manual && (!source.original.recognition || !source.current.recognition))
    )
      return;
    const input = signature(source),
      job = {
        token: crypto.randomUUID(),
        controller: new AbortController(),
        started: performance.now(),
      };
    state.review = job;
    state.errors = [];
    this.mutate(
      id,
      (r) => ({
        ...r,
        draft: {
          ...r.draft,
          aiReview: {
            status: "running",
            summary: "正在复核当前字段和计算结果…",
            responseText: r.draft.aiReview?.responseText ?? "",
            changes: [],
            warnings: [],
            time: new Date().toISOString(),
          },
        },
      }),
      false,
    );
    try {
      source.result = evaluate(source).result;
      if (job.controller.signal.aborted) return;
      const response = await this.reviewer(source, {}, job.controller.signal);
      if (
        state.review !== job ||
        !this.get(id) ||
        signature(this.get(id)!.draft) !== input
      )
        return;
      const applied = applyReview(this.get(id)!.draft, response);
      const warnings: NonNullable<Snapshot["aiReview"]>["warnings"] = [
        ...response.warnings.map((w) => ({ w, shift: true })),
        ...applied.warnings.map((w) => ({ w, shift: false })),
      ].flatMap(({ w, shift }) => {
        const matched = /^discounts[.\[]([0-9]+)/.exec(w.field);
        const field = Object.prototype.hasOwnProperty.call(
          FIELD_LABELS,
          w.field,
        )
          ? (w.field as Field)
          : undefined;
        const index = w.index ?? (matched ? Number(matched[1]) : undefined);
        return (
          w.side === "both" ? (["original", "current"] as const) : [w.side]
        ).flatMap((side) => {
          const removed = shift
            ? applied.applied
                .filter((c) => c.kind === "removeDiscount" && c.side === side)
                .map((c) => c.index!)
            : [];
          if (index !== undefined && removed.includes(index)) return [];
          const relocated =
            index === undefined
              ? undefined
              : index - removed.filter((i) => i < index).length;
          return [{ side, field, index: relocated, message: w.message }];
        });
      });
      const conciseWarnings = warnings
        .filter(
          (w, i, all) =>
            all.findIndex(
              (v) =>
                v.side === w.side &&
                v.field === w.field &&
                v.index === w.index &&
                v.message === w.message,
            ) === i,
        )
        .slice(0, 3);
      const draft = {
        ...applied.snapshot,
        aiReview: {
          status: "done" as const,
          summary: response.summary,
          responseText: response.rawText,
          actions: response.actions,
          changes: [
            ...applied.applied.map(
              (v) =>
                `${v.side === "original" ? "原订单" : "现订单"} · ${v.field ? FIELD_LABELS[v.field] : v.index !== undefined ? "优惠第" + (v.index + 1) + "行" : v.kind === "addDiscount" ? "增补优惠 " + v.row?.name : v.property} → ${v.kind === "removeDiscount" ? "移除" : v.kind === "addDiscount" ? v.row?.amount : String(v.value)}；${v.reason}`,
            ),
            ...applied.recalculate.map(
              (v) =>
                `${v.side === "original" ? "原订单" : "现订单"} · ${v.field ? FIELD_LABELS[v.field] : "金额字段"}已交由代码按当前数据重算，未采用模型返回金额。`,
            ),
          ],
          warnings: conciseWarnings,
          elapsedMs: response.elapsedMs,
          time: new Date().toISOString(),
        },
      };
      this.mutate(id, (r) => this.revision({ ...r, draft }), false);
    } catch (e) {
      if (state.review === job && !job.controller.signal.aborted)
        this.mutate(
          id,
          (r) => ({
            ...r,
            draft: {
              ...r.draft,
              aiReview: {
                status: "failed",
                summary: `AI复核失败：${(e as Error).message}，可点击AI复核重试。`,
                responseText: "",
                changes: [],
                warnings: [],
                time: new Date().toISOString(),
              },
            },
          }),
          false,
        );
    } finally {
      if (state.review === job) {
        delete state.review;
        this.emit();
      }
    }
  }
  async remove(id: string) {
    this.cancel(id);
    for (const [key, job] of this.chatRequests)
      if (key.startsWith(`${id}:`)) {
        job.controller.abort();
        this.chatRequests.delete(key);
      }
    await this.repo.remove(id);
    this.records.delete(id);
    this.activities.delete(id);
    this.emit();
  }
}
const idOf = (r: CaseFile) => r.id;
