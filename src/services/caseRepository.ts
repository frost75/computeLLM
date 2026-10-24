import type { CaseFile } from "../domain/contracts";
import { cloudEnabled, cloudRequest, hash, imageIds } from "./cloud";
type Pending = { id: string; record: CaseFile | null; version: string };
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("refund-workbench-v2", 2);
  request.onupgradeneeded = () => {
    for (const name of ["cases", "images", "outbox", "meta"])
      if (!request.result.objectStoreNames.contains(name))
        request.result.createObjectStore(
          name,
          name === "cases" || name === "outbox" ? { keyPath: "id" } : undefined,
        );
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error("本机案例库无法打开"));
  request.onblocked = () => reject(new Error("请关闭旧版工具标签页后重新打开"));
});
async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  operation: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode),
      r = operation(t.objectStore(store));
    t.oncomplete = () => resolve(r.result);
    t.onerror = t.onabort = () => reject(t.error ?? new Error("本机保存失败"));
  });
}
const states = new Map<string, string>();
const listeners = new Set<(id: string, message: string) => void>();
const publish = (id: string, message: string) => {
  states.set(id, message);
  listeners.forEach((fn) => fn(id, message));
};
let writes: Promise<unknown> = Promise.resolve(),
  syncing = false,
  timer: ReturnType<typeof setTimeout> | undefined;
async function sync() {
  if (!cloudEnabled || syncing || !navigator.onLine) return;
  syncing = true;
  try {
    for (const pending of await run<Pending[]>("outbox", "readonly", (s) =>
      s.getAll(),
    )) {
      try {
        publish(pending.id, "本机已保存 · 云端同步中");
        if (pending.record)
          for (const id of imageIds(pending.record)) {
            if (await run("meta", "readonly", (s) => s.get("image:" + id)))
              continue;
            const dataUrl = await run<string>("images", "readonly", (s) =>
              s.get(id),
            );
            if (!dataUrl) throw new Error("本机截图缺失，记录仍在待同步队列");
            const acknowledged = await cloudRequest("/images/" + id, "PUT", {
              dataUrl,
            });
            if (acknowledged.receipt !== (await hash(dataUrl)))
              throw new Error("云端截图回执校验失败");
            await run("meta", "readwrite", (s) =>
              s.put(acknowledged.receipt, "image:" + id),
            );
          }
        const payload = {
          caseData: pending.record,
          images: {},
          deleted: pending.record === null,
        };
        const receipt = await hash(JSON.stringify(payload));
        const previousReceipt = await run<string | undefined>(
          "meta",
          "readonly",
          (s) => s.get("case:" + pending.id),
        );
        const acknowledged = await cloudRequest("/" + pending.id, "PUT", {
          payload,
          receipt,
          previousReceipt,
        });
        if (acknowledged.receipt !== receipt)
          throw new Error("云端记录回执校验失败");
        const db = await database;
        await new Promise<void>((resolve, reject) => {
          const t = db.transaction(["outbox", "meta"], "readwrite");
          t.objectStore("meta").put(receipt, "case:" + pending.id);
          const q = t.objectStore("outbox").get(pending.id);
          q.onsuccess = () => {
            if (q.result?.version === pending.version)
              t.objectStore("outbox").delete(pending.id);
          };
          t.oncomplete = () => resolve();
          t.onerror = t.onabort = () => reject(t.error);
        });
        const remaining = await run<Pending | undefined>(
          "outbox",
          "readonly",
          (s) => s.get(pending.id),
        );
        publish(
          pending.id,
          remaining ? "本机已保存 · 云端待同步" : "已保存到云端",
        );
      } catch (e) {
        publish(pending.id, `本机已保存 · 云端待同步：${(e as Error).message}`);
      }
    }
  } finally {
    syncing = false;
    if (
      (await run<Pending[]>("outbox", "readonly", (s) => s.getAll())).length
    ) {
      clearTimeout(timer);
      timer = setTimeout(() => void sync(), 15000);
    }
  }
}
if (cloudEnabled) {
  window.addEventListener("online", () => void sync());
  void database.then(() => sync());
}
async function store(record: CaseFile | null, id: string) {
  const snapshot = record ? structuredClone(record) : null;
  const db = await database;
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(
      cloudEnabled ? ["cases", "outbox"] : ["cases"],
      "readwrite",
    );
    snapshot
      ? t.objectStore("cases").put(snapshot)
      : t.objectStore("cases").delete(id);
    if (cloudEnabled)
      t.objectStore("outbox").put({
        id,
        record: snapshot,
        version: crypto.randomUUID(),
      } satisfies Pending);
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error);
  });
  publish(id, cloudEnabled ? "本机已保存 · 云端待同步" : "已保存到本机");
  void sync();
}
let restoring: Promise<void> | undefined;
async function restore() {
  if (!cloudEnabled) return;
  if (restoring) return restoring;
  restoring = (async () => {
    try {
      const remote = (await cloudRequest("")) as {
        case_id: string;
        case_data: CaseFile;
        receipt: string;
        deleted: boolean;
      }[];
      for (const row of remote) {
        if (await run("outbox", "readonly", (s) => s.get(row.case_id)))
          continue;
        await run("cases", "readwrite", (s) =>
          row.deleted ? s.delete(row.case_id) : s.put(row.case_data),
        );
        await run("meta", "readwrite", (s) =>
          s.put(row.receipt, "case:" + row.case_id),
        );
        publish(row.case_id, "已保存到云端");
      }
    } catch {
      /* 离线保留本机副本；保存状态由待同步队列回报。 */
    }
  })();
  await restoring;
}
export const repository = {
  async list() {
    if (cloudEnabled && !restoring)
      void restore().then(() => publish("__refresh__", ""));
    return run<CaseFile[]>("cases", "readonly", (s) => s.getAll());
  },
  save(record: CaseFile) {
    const snapshot = structuredClone(record);
    const result = writes
      .catch(() => {})
      .then(() => store(snapshot, snapshot.id));
    writes = result;
    return result;
  },
  async image(id: string) {
    const local = await run<string | undefined>("images", "readonly", (s) =>
      s.get(id),
    );
    if (local || !cloudEnabled) return local;
    const remote = await cloudRequest("/images/" + id);
    await run("images", "readwrite", (s) => s.put(remote.data_url, id));
    return remote.data_url as string;
  },
  putImage: (id: string, data: string) =>
    run("images", "readwrite", (s) => s.put(data, id)),
  status: (id: string) =>
    states.get(id) ?? (cloudEnabled ? "云端同步状态待确认" : "已保存到本机"),
  subscribe(fn: (id: string, message: string) => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  retry: () => sync(),
  async remove(id: string) {
    await writes.catch(() => {});
    await store(null, id);
    const db = await database;
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(["cases", "images", "outbox"], "readwrite");
      const q = t.objectStore("cases").getAll();
      const pending = t.objectStore("outbox").getAll();
      let cases: CaseFile[] | undefined, outbox: Pending[] | undefined;
      const cleanup = () => {
        if (!cases || !outbox) return;
        const used = new Set<string>();
        for (const record of [
          ...cases,
          ...outbox.flatMap((v) => (v.record ? [v.record] : [])),
        ])
          for (const img of imageIds(record)) used.add(img);
        const c = t.objectStore("images").openCursor();
        c.onsuccess = () => {
          const row = c.result;
          if (row) {
            if (!used.has(String(row.key))) row.delete();
            row.continue();
          }
        };
      };
      q.onsuccess = () => {
        cases = q.result;
        cleanup();
      };
      pending.onsuccess = () => {
        outbox = pending.result;
        cleanup();
      };
      t.oncomplete = () => resolve();
      t.onerror = t.onabort = () => reject(t.error);
    });
  },
};
