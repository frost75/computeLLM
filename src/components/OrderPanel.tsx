import { useEffect, useState, useRef } from "react";
import {
  FIELD_LABELS,
  CATEGORIES,
  type OrderInput,
  type Field,
  type Discount,
} from "../domain/contracts";
import { value } from "../domain/rules";
import { couponLine } from "../domain/automation";
import { yuan } from "../domain/money";
import { repository } from "../services/cases";
export default function OrderPanel({
  title,
  order,
  platform,
  change,
  upload,
  busy,
  cancel,
  readOnly = false,
}: {
  title: string;
  order: OrderInput;
  platform: string;
  change: (o: OrderInput) => void;
  upload: (f: File) => void;
  busy: boolean;
  cancel: () => void;
  readOnly?: boolean;
}) {
  const [image, setImage] = useState(""),
    [imageError, setImageError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let live = true;
    setImage("");
    setImageError("");
    if (order.imageId)
      repository
        .image(order.imageId)
        .then((v) => {
          if (live) {
            setImage(v ?? "");
            if (!v) setImageError("截图暂未取回，可重试打开案例");
          }
        })
        .catch(() => {
          if (live) setImageError("截图读取失败，请重试");
        });
    return () => {
      live = false;
    };
  }, [order.imageId]);
  const lines = order.discounts ?? order.recognition?.discounts ?? [];
  const spendingFields = (["ecard", "giftCard", "paymentGift", "tradeInSubsidy", "tradeInOldMachine"] as const)
    .filter((key) => order.recognition?.fields[key]?.presence === "visible" ||
      order.recognition?.spendingRows?.some((row) => row.field === key) ||
      (order.overrides[key] !== undefined && order.overrides[key] !== ""));
  const spendingAmount = (key: Field) => {
    try {
      const amount = value(order, key);
      return amount === null ? "待校正" : `¥${yuan(amount)}`;
    } catch { return "待校正"; }
  };
  const editLine = (i: number, patch: Partial<Discount>) =>
    change({
      ...order,
      discounts: lines.map((l, j) =>
        j === i
          ? { ...l, ...patch, payerSource: "manual", payerReason: "客服已调整" }
          : l,
      ),
      discountsConfirmed: true,
    });
  const field = (k: Field) => {
    const observation = order.recognition?.fields[k];
    let shown =
      order.overrides[k] ??
      (observation?.presence === "visible"
        ? (observation.amount ?? "")
        : observation?.presence === "absent"
          ? "0"
          : "");
    try {
      if (
        order.overrides[k] === undefined &&
        order.recognition?.spendingRows?.some((r) => r.field === k)
      )
        shown = String((value(order, k) ?? 0) / 1000);
    } catch {}
    return (
      <label key={k}>
        {FIELD_LABELS[k]}
        <input
          inputMode="decimal"
          value={shown}
          placeholder="未显示"
          onChange={(e) =>
            change({
              ...order,
              overrides: { ...order.overrides, [k]: e.target.value },
              ...(k === "discountTotal" ? { discountsConfirmed: true } : {}),
            })
          }
        />
        {observation?.confidence !== undefined &&
          observation.confidence < 0.75 &&
          observation.presence === "visible" && (
            <small className="attention-note">金额可能不清晰，请对照图片</small>
          )}
      </label>
    );
  };
  const refund = (() => {
    try {
      return value(order, "refundAmount") ?? 0;
    } catch {
      return 0;
    }
  })();
  return (
    <section className="order">
      <div className="order-heading">
        <h2>{title}</h2>
        <span className="order-status">
          {busy ? "正在识别…" : order.recognition ? "已自动识别" : "等待截图"}
        </span>
      </div>
      <div
        className={`drop ${image ? "has-image" : ""}`}
        tabIndex={0}
        aria-label={`${title}截图粘贴区域`}
        onPointerDown={(e) => {
          if (!(e.target as HTMLElement).closest("button, input, label"))
            e.currentTarget.focus();
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!readOnly && e.dataTransfer.files[0])
            upload(e.dataTransfer.files[0]);
        }}
        onPaste={(e) => {
          const f = Array.from(e.clipboardData.items)
            .find((i) => i.type.startsWith("image/"))
            ?.getAsFile();
          if (f && !readOnly) {
            e.preventDefault();
            upload(f);
          }
        }}
      >
        {image ? (
          <button
            type="button"
            className="image-open"
            aria-label={`放大${title}截图`}
            onClick={() => dialog.current?.showModal()}
          >
            <img src={image} alt={`${title}截图`} />
            <span>点击查看大图</span>
          </button>
        ) : (
          <div className="upload-placeholder">
            <span>＋</span>
            <p>上传{title}截图</p>
            {readOnly ? <small>该历史修订未保存截图</small> : <>
              <strong className="paste-guide">点击此处后，<kbd>Ctrl+V</kbd></strong>
              <small>粘贴{title}截图，也可以拖入图片</small>
            </>}
          </div>
        )}
        {!readOnly && <div className="image-actions">
          <label className="button">
            {image ? "替换截图" : "选择图片"}
            <input
              type="file"
              disabled={readOnly}
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
          </label>
          {busy && <button onClick={cancel}>取消识别</button>}
        </div>}
      </div>
      {imageError && <p className="error">{imageError}</p>}
      <dialog
        className="image-dialog"
        ref={dialog}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="image-dialog-bar">
          <strong>{title}截图</strong>
          <button autoFocus onClick={() => dialog.current?.close()}>
            关闭 ×
          </button>
        </div>
        <div className="image-dialog-scroll">
          <img src={image} alt={`${title}完整截图`} />
        </div>
      </dialog>
      <fieldset disabled={busy || readOnly}>
        <div className="order-summary">
          {refund > 0 && (
            <span className="refund-pill">已退价保 ¥{yuan(refund)}</span>
          )}
        </div>
        {(order.recognition || lines.length > 0) && (
          <>
            <div className="discount-heading">
              <h3>优惠明细</h3>
              <span>券类可切换承担方</span>
            </div>
            <div className="discount-list">
              {lines.map((row, i) => {
                const uncertain =
                  row.category === "unknown" ||
                  (row.payerSource !== "manual" &&
                    ((row.payerSource === "inferred" &&
                      row.confidence < 0.85) ||
                      row.confidence < 0.75));
                return (
                  <div
                    key={i}
                    className={`discount-row ${uncertain ? "needs-attention" : ""}`}
                  >
                    <div className="discount-name">
                      <strong>{row.name || CATEGORIES[row.category]}</strong>
                      {uncertain && (
                        <small title={row.payerReason || "识别不确定"}>
                          建议关注 · {row.payerReason || "金额或分类不清晰"}
                        </small>
                      )}
                    </div>
                    <label className="inline-money">
                      <span>¥</span>
                      <input
                        aria-label={`${row.name}金额`}
                        value={row.amount}
                        onChange={(e) =>
                          editLine(i, { amount: e.target.value })
                        }
                      />
                    </label>
                    {couponLine(row) ? <div
                      className="payer-toggle"
                      aria-label={`${row.name}承担方`}
                    >
                      {(["store", "platform"] as const).map((payer) => (
                        <button
                          type="button"
                          aria-pressed={row.payer === payer}
                          key={payer}
                          className={row.payer === payer ? "selected" : ""}
                          onClick={() => editLine(i, { payer })}
                        >
                          {payer === "store" ? "商家" : "平台"}
                        </button>
                      ))}
                    </div> : <span className="payer-label">
                      {["governmentSubsidy", "nationalSubsidy"].includes(row.category)
                        ? "政府补贴"
                        : row.payer === "store" ? "商家承担"
                        : row.payer === "platform" ? "平台承担" : "待归类"}
                    </span>}
                  </div>
                );
              })}
              {!lines.length && (
                <p className="empty-lines">未发现单列优惠项目</p>
              )}
            </div>
          </>
        )}
        {spendingFields.length > 0 && <div className="spending-group">
          <div className="discount-heading">
            <h3>支付与抵扣（计入用户支出）</h3>
          </div>
          <p>支付组成，不作为平台券</p>
          <div className="spending-list">
            {spendingFields.map((key) => <div key={key}>
              <span>{FIELD_LABELS[key]}</span><strong>{spendingAmount(key)}</strong>
            </div>)}
          </div>
        </div>}
        {platform === "jd" && (
          <div className="subsidy-strip">
            <span>政府补贴比例</span>
            <label>
              <input
                aria-label={`${title}政府补贴比例`}
                inputMode="decimal"
                value={order.subsidyRate}
                onChange={(e) =>
                  change({ ...order, subsidyRate: e.target.value })
                }
              />
              <span>%</span>
            </label>
            <small title="由识别与订单明细自动判断，明确实付时无需另算">
              {order.subsidyInTotals === "included"
                ? "已含在优惠中"
                : order.subsidyInTotals === "excluded"
                  ? "按订单明细处理"
                  : "自动判断包含关系"}
            </small>
          </div>
        )}
        <details className="corrections">
          <summary>
            金额字段与来源校正 <span>识别有误时展开修改</span>
          </summary>
          <div className="fields">
            {(Object.keys(FIELD_LABELS) as Field[])
              .filter((k) =>
                platform === "jd"
                  ? k !== "serviceFee"
                  : [
                      "actualPayment",
                      "serviceFee",
                      "discountTotal",
                      "orderAmount",
                      "freight",
                    ].includes(k),
              )
              .map(field)}
          </div>
          <div className="advanced-settings">
            <label>
              政府补贴包含关系
              <select
                value={order.subsidyInTotals}
                onChange={(e) =>
                  change({
                    ...order,
                    subsidyInTotals: e.target
                      .value as OrderInput["subsidyInTotals"],
                  })
                }
              >
                <option value="unknown">自动判断</option>
                <option value="included">已包含在优惠总额</option>
                <option value="excluded">未包含</option>
              </select>
            </label>
            <label>
              已退金额是否已计入客户实付
              <select
                value={order.refundAlreadyIncluded ? "included" : "excluded"}
                onChange={(e) =>
                  change({
                    ...order,
                    refundAlreadyIncluded: e.target.value === "included",
                  })
                }
              >
                <option value="excluded">实付中尚未扣除，由工具扣减</option>
                <option value="included">实付已扣除，不重复扣减</option>
              </select>
            </label>
          </div>
          {lines.some((l) => l.category === "unknown") &&
            lines.map((l, i) =>
              l.category === "unknown" ? (
                <label key={i}>
                  {l.name}分类
                  <select
                    value={l.category}
                    onChange={(e) =>
                      editLine(i, {
                        category: e.target.value as Discount["category"],
                      })
                    }
                  >
                    {Object.entries(CATEGORIES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null,
            )}
        </details>
      </fieldset>
    </section>
  );
}
