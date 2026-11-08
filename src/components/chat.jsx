/* ==================================================================== *
 *  CHAT — a quiet back-channel between two GMs on two computers
 *
 *  • a "chat" pill in the top dock (and an unread count on the "menu"
 *    handle while the dock is hidden, and on the browser tab title)
 *  • a popup bottom-left for each new message, gone after eight seconds
 *  • a small window near the top of the page: name, time, message
 *  • ` toggles the window from anywhere you're not typing
 *
 *  One conversation per scenario, today's messages only, desktop only
 *  (the phone cheat sheet never mounts this). Messages live in the
 *  chat_messages table (supabase/migrations/0003_chat.sql), outside the
 *  overlay. Who's who is a random per-device id plus a display name, both
 *  kept in localStorage; so is the last-read time per scenario.
 * ==================================================================== */
import { useState, useEffect, useRef } from "react";
import { formatTime, cleanBody, cleanName, isTyping, MAX_BODY, MAX_NAME } from "../lib/chat.js";

const TOAST_MS = 8000;

/* ------------------------------------------------------------------ *
 *  pill in the dock
 * ------------------------------------------------------------------ */
export function ChatPill({ chat }) {
  const { unread, open, toggle } = chat;
  return (
    <button
      className={`dock-chat${open ? " on" : ""}${unread ? " unread" : ""}`}
      onClick={toggle}
      title="chat with the other gm  ( ` )"
      aria-label={unread ? `chat, ${unread} unread` : "chat"}
    >
      chat
      {unread > 0 && <span className="dock-chat-badge">{unread}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 *  window + popups + shortcut + tab title
 * ------------------------------------------------------------------ */
export function ChatLayer({ chat, dockVisible }) {
  const { open, toggle, unread, arrivals } = chat;

  // ` toggles the window whenever you're not typing somewhere.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "`" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // "(2) PF2e Binder" while there's unread chat, so it shows from another window.
  const baseTitle = useRef(null);
  useEffect(() => {
    if (baseTitle.current == null) baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = unread ? `(${unread}) ${baseTitle.current}` : baseTitle.current;
  }, [unread]);
  useEffect(() => () => { if (baseTitle.current != null) document.title = baseTitle.current; }, []);

  return (
    <>
      {open && <ChatWindow chat={chat} dockVisible={dockVisible} />}
      {!open && arrivals.length > 0 && (
        <div className="chat-toasts" aria-live="polite">
          {arrivals.map((m) => (
            <ChatToast key={m.id} msg={m} onOpen={chat.show} onDone={chat.dismiss} />
          ))}
        </div>
      )}
    </>
  );
}

function ChatToast({ msg, onOpen, onDone }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), TOAST_MS);
    const t2 = setTimeout(() => onDone(msg.id), TOAST_MS + 400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [msg.id, onDone]);
  return (
    <button className={`chat-toast${leaving ? " leaving" : ""}`} onClick={onOpen} title="open chat">
      <MsgMeta msg={msg} />
      <span className="chat-text">{msg.body}</span>
    </button>
  );
}

function MsgMeta({ msg }) {
  return (
    <span className="chat-meta">
      <span className="chat-name">{msg.author_name}</span>
      <span className="chat-time">{msg.pending ? "sending…" : formatTime(msg.created_at)}</span>
    </span>
  );
}

function ChatWindow({ chat, dockVisible }) {
  const { messages, name, setName, send, sendError, status, hide } = chat;
  const [draft, setDraft] = useState("");
  const [editingName, setEditingName] = useState(!name);
  const [nameDraft, setNameDraft] = useState(name);
  const logRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  useEffect(() => {
    inputRef.current?.focus();
  }, [editingName]);

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hide();
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    const text = draft;
    if (!cleanBody(text)) return;
    setDraft("");
    const ok = await send(text);
    if (!ok) setDraft((cur) => cur || text);
    inputRef.current?.focus();
  };
  const saveName = (e) => {
    e.preventDefault();
    if (!cleanName(nameDraft)) return;
    setName(nameDraft);
    setEditingName(false);
  };

  return (
    <div className={`chat-window${dockVisible ? " below-dock" : ""}`} role="dialog" aria-label="chat" onKeyDown={onKeyDown}>
      <div className="chat-head">
        <span className="chat-title">chat</span>
        {name && !editingName && (
          <button className="chat-as" onClick={() => { setNameDraft(name); setEditingName(true); }} title="change your name">
            as {name}
          </button>
        )}
        <button className="chat-close" onClick={hide} aria-label="close chat">×</button>
      </div>

      {status === "unavailable" ? (
        <div className="chat-note">
          chat isn't set up on the server yet. run <code>supabase/migrations/0003_chat.sql</code> in the supabase sql editor, then reopen this.
        </div>
      ) : (
        <ul className="chat-log" ref={logRef}>
          {messages.length === 0 && (
            <li className="chat-empty">
              {status === "loading" ? "loading…" : status === "offline" ? "can't reach the server right now." : "no messages today."}
            </li>
          )}
          {messages.map((m) => (
            <li key={m.id} className={`chat-msg${m.pending ? " pending" : ""}`}>
              <MsgMeta msg={m} />
              <span className="chat-text">{m.body}</span>
            </li>
          ))}
        </ul>
      )}

      {status !== "unavailable" && (editingName ? (
        <form className="chat-compose" onSubmit={saveName}>
          <input
            ref={inputRef}
            id="chat-name"
            className="chat-input"
            value={nameDraft}
            maxLength={MAX_NAME}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="your name, as the other gm sees it"
            autoComplete="off"
          />
          <button className="chat-send" disabled={!cleanName(nameDraft)}>save</button>
        </form>
      ) : (
        <form className="chat-compose" onSubmit={submit}>
          <input
            ref={inputRef}
            id="chat-input"
            className="chat-input"
            value={draft}
            maxLength={MAX_BODY}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="message the other gm…"
            autoComplete="off"
          />
          <button className="chat-send" disabled={!cleanBody(draft)}>send</button>
        </form>
      ))}
      {sendError && <div className="chat-error">{sendError}</div>}
    </div>
  );
}
