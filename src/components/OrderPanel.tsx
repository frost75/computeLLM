import { useEffect, useState, useRef } from "react";
import {
  FIELD_LABELS,
  CATEGORIES,
  type OrderInput,
  type Field,
  type Discount,
} from "../domain/contracts";
import { value } from "../domain/rules";
import {
  calculateSettlement,
  setSubsidyAmount,
  setSubsidyRate,
  governmentLine,
  isSubsidyLocked,
} from "../domain/settlement";
import { couponLine, normalizeDiscount } from "../domain/automation";
import { yuan, money } from "../domain/money";
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
  reviewWarnings = [],
  reviewed = false,
}: {
  title: string;
  order: OrderInput;
  platform: string;
  change: (o: OrderInput) => void;
  upload: (f: File) => void;
  busy: boolean;
  cancel: () => void;
  readOnly?: boolean;
  reviewWarnings?: { field?: Field; index?: number; message: string }[];
  reviewed?: boolean;
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
  const lines = (order.discounts ?? order.recognition?.discounts ?? []).map(
    (line) => normalizeDiscount(line, platform),
  );
  const settlement = (() => {
    try {
      return platform === "jd" ? calculateSettlement(order) : null;
    } catch {
      return null;
    }
  })();
  const rateLocked = (() => {
    try {
      return platform === "jd" && isSubsidyLocked(order);
    } catch {
      return false;
    }
  })();
  const rateText =
    settlement?.rateLocked || order.subsidyControl?.mode === "amount"
      ? settlement
        ? String(Number(settlement.rate.toFixed(6)))
        : order.subsidyRate
      : order.subsidyRate;
  const subsidyText =
    order.subsidyControl?.mode === "amount"
      ? (order.subsidyControl.amount ?? "")
      : settlement
        ? String(settlement.subsidy / 1000)
        : (order.overrides.subsidyAmount ?? "");
  const spendingFields = (
    [
      "ecard",
      "giftCard",
      "paymentGift",
      "tradeInSubsidy",
      "tradeInOldMachine",
    ] as const
  ).filter(
    (key) =>
      order.recognition?.fields[key]?.presence === "visible" ||
      order.recognition?.spendingRows?.some((row) => row.field === key) ||
      (order.overrides[key] !== undefined && order.overrides[key] !== ""),
  );
  const spendingAmount = (key: Field) => {
    try {
      const amount = value(order, key);
      return amount === null ? "待校正" : `¥${yuan(amount)}`;
    } catch {
      return "待校正";
    }
  };
  const editLine = (i: number, patch: Partial<Discount>) => {
    let next: OrderInput = {
      ...order,
      discounts: lines.map((l, j) =>
        j === i
          ? { ...l, ...patch, payerSource: "manual", payerReason: "客服已调整" }
          : l,
      ),
      discountsConfirmed: true,
    };
    if (
      platform === "jd" &&
      patch.amount !== undefined &&
      governmentLine(lines[i].name, lines[i].category)
    ) {
      try {
        const total = next
          .discounts!.filter((row) => governmentLine(row.name, row.category))
          .reduce((n, row) => n + money(row.amount), 0);
        if (Number.isSafeInteger(total) && total >= 0)
          next = setSubsidyAmount(next, String(total / 1000));
      } catch {
        /* Keep in-progress edits intact. */
      }
    }
    change(next);
  };
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
        platform === "jd" &&
        (k === "actualPayment" || k === "subsidyAmount") &&
        settlement
      )
        shown = String(
          (k === "actualPayment" ? settlement.payment : settlement.subsidy) /
            1000,
        );
      if (
        order.overrides[k] === undefined &&
        order.recognition?.spendingRows?.some((r) => r.field === k)
      )
        shown = String((value(order, k) ?? 0) / 1000);
    } catch {}
    return (
      <label key={k}>
        {platform === "jd" && k === "subsidyAmount"
          ? "政府补贴金额"
          : FIELD_LABELS[k]}
        <input
          inputMode="decimal"
          value={shown}
          placeholder="未显示"
          onChange={(e) =>
            change(
              platform === "jd" && k === "subsidyAmount"
                ? setSubsidyAmount(order, e.target.value)
                : {
                    ...order,
                    overrides: { ...order.overrides, [k]: e.target.value },
                    ...(k === "discountTotal"
                      ? { discountsConfirmed: true }
                      : {}),
                  },
            )
          }
        />
        {platform === "jd" && k === "actualPayment" && settlement && (
          <small className="hint">
            {settlement.source === "manual-payment"
              ? "已使用手动金额"
              : settlement.source === "observed-subsidy"
                ? "按已识别补贴填入"
                : "按补贴规则自动填入"}
            ；截图原值保留。
          </small>
        )}
        {observation?.confidence !== undefined &&
          observation.confidence < 0.75 &&
          observation.presence === "visible" && (
            <small className="attention-note">金额可能不清晰，请对照图片</small>
          )}
        {reviewWarnings
          .filter((w) => w.field === k)
          .map((w, i) => (
            <small className="attention-note" role="alert" key={i}>
              ⚠️ {w.message}
            </small>
          ))}
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
      {reviewWarnings
        .filter((w) => w.field === undefined && w.index === undefined)
        .map((w, i) => (
          <p className="attention-note" role="alert" key={i}>
            ⚠️ {w.message}
          </p>
        ))}
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
            {readOnly ? (
              <small>该历史修订未保存截图</small>
            ) : (
              <>
                <strong className="paste-guide">
                  点击此处后，<kbd>Ctrl+V</kbd>
                </strong>
                <small>粘贴{title}截图，也可以拖入图片</small>
              </>
            )}
          </div>
        )}
        {!readOnly && (
          <div className="image-actions">
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
          </div>
        )}
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
              <span>
                {platform === "jd"
                  ? "商家优惠参与退差 · 点击切换承担方"
                  : "券类可切换承担方"}
              </span>
            </div>
            <div className="discount-list">
              {lines.map((row, i) => {
                const uncertain =
                  row.category === "unknown" ||
                  reviewWarnings.some((w) => w.index === i) ||
                  (!reviewed &&
                    row.payerSource !== "manual" &&
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
                      {uncertain &&
                        !reviewed &&
                        !reviewWarnings.some((w) => w.index === i) && (
                          <small title={row.payerReason || "识别不确定"}>
                            建议关注 · {row.payerReason || "金额或分类不清晰"}
                          </small>
                        )}
                      {reviewWarnings
                        .filter((w) => w.index === i)
                        .map((w, j) => (
                          <small
                            className="attention-note"
                            role="alert"
                            key={j}
                          >
                            ⚠️ {w.message}
                          </small>
                        ))}
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
                    {platform === "jd" || couponLine(row) ? (
                      <div
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
                      </div>
                    ) : (
                      <span className="payer-label">
                        {["governmentSubsidy", "nationalSubsidy"].includes(
                          row.category,
                        )
                          ? "政府补贴"
                          : row.payer === "store"
                            ? "商家承担"
                            : row.payer === "platform"
                              ? "平台承担"
                              : "待归类"}
                      </span>
                    )}
                  </div>
                );
              })}
              {!lines.length && (
                <p className="empty-lines">未发现单列优惠项目</p>
              )}
            </div>
          </>
        )}
        {spendingFields.length > 0 && (
          <div className="spending-group">
            <div className="discount-heading">
              <h3>支付与抵扣（计入用户支出）</h3>
            </div>
            <p>支付组成，不作为平台券</p>
            <div className="spending-list">
              {spendingFields.map((key) => (
                <div key={key}>
                  <span>{FIELD_LABELS[key]}</span>
                  <strong>{spendingAmount(key)}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
        {platform === "jd" && (
          <div className="subsidy-strip">
            <span>政府补贴金额</span>
            <label>
              <span>¥</span>
              <input
                className="subsidy-amount-input"
                aria-label={`${title}政府补贴金额`}
                inputMode="decimal"
                value={subsidyText}
                onChange={(e) =>
                  change(setSubsidyAmount(order, e.target.value))
                }
              />
            </label>
            <span>政府补贴比例</span>
            <label>
              <input
                aria-label={`${title}政府补贴比例`}
                inputMode="decimal"
                value={rateText}
                disabled={rateLocked}
                onChange={(e) => change(setSubsidyRate(order, e.target.value))}
              />
              <span>%</span>
            </label>
            <small>
              {rateLocked
                ? "已按识别金额锁定；修改补贴金额可解锁"
                : "修改比例将同步计算补贴与客户实付"}
            </small>
          </div>
        )}
        <details
          className="corrections"
          open={
            reviewWarnings.some((w) => w.field !== undefined) ? true : undefined
          }
        >
          <summary>
            金额字段与来源校正 <span>识别有误时展开修改</span>
          </summary>
          <div className="fields">
            {(Object.keys(FIELD_LABELS) as Field[])
              .filter((k) =>
                platform === "jd"
                  ? !["serviceFee", "discountTotal", "platformCoupon"].includes(
                      k,
                    )
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
