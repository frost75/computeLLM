import { useState } from "react";
import type { CaseChatThread } from "../domain/contracts";
import { yuan } from "../domain/money";

export default function CaseChatPanel({
  thread,
  busy,
  onSend,
  onRetry,
}: {
  thread?: CaseChatThread;
  busy: boolean;
  onSend: (question: string) => void;
  onRetry: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [copyError, setCopyError] = useState("");
  function send() {
    if (!question.trim() || busy) return;
    onSend(question.trim());
    setQuestion("");
  }
  return (
    <section className="case-chat" aria-label="本案例AI问答">
      <div className="case-chat-heading">
        <strong>围绕本例问AI</strong>
        <span>回答可直接发送给用户</span>
      </div>
      <p className="hint">
        每次提问按当前金额回答，保留本案例的对话，不发送截图。
      </p>
      <div
        className="case-chat-messages"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {!thread?.messages.length && (
          <p className="case-chat-empty">
            例如：为什么是这个退差金额？哪些优惠不参与退差？
          </p>
        )}
        {thread?.messages.map((message) => (
          <article
            key={message.id}
            className={`case-chat-message ${message.role}`}
          >
            <strong>
              {message.role === "user" ? "我的问题" : "可发送给用户"}
            </strong>
            <div className="case-chat-text">{message.content}</div>
            {message.role === "assistant" && (
              <footer>
                <span>
                  {message.context?.result &&
                    `本轮依据：可退差价 ¥${yuan(message.context.result.base)}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCopyError("");
                    void navigator.clipboard
                      .writeText(message.content)
                      .catch(() =>
                        setCopyError("复制失败，请选取回复手动复制"),
                      );
                  }}
                >
                  复制回复
                </button>
              </footer>
            )}
          </article>
        ))}
        {busy && (
          <p className="hint" role="status">
            正在根据本案例信息生成回复…切换案例后仍会继续。
          </p>
        )}
      </div>
      {(thread?.error ||
        (!busy && thread?.messages[thread.messages.length - 1]?.role === "user")) && (
        <div className="case-chat-error" role="alert">
          {thread?.error || "上一问尚未回复，可重新发送。"}{" "}
          <button type="button" disabled={busy} onClick={onRetry}>
            重试上一问
          </button>
        </div>
      )}
      {copyError && <p role="alert">{copyError}</p>}
      <form
        className="case-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          aria-label="关于本例退差的问题"
          placeholder="输入关于本例退差的问题…"
          rows={3}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key === "Enter" &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" disabled={busy || !question.trim()}>
          {busy ? "回复中…" : "发送"}
        </button>
      </form>
    </section>
  );
}
