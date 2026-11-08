/* ------------------------------------------------------------------ *
 *  useChat — state for the active scenario's co-GM chat (see chat.jsx)
 * ------------------------------------------------------------------ */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { remoteListChat, remoteSendChat, subscribeChat, ChatUnavailable } from "../data/supabase.js";
import {
  startOfDay, mergeMessages, todaysMessages, unreadCount, latestTime, cleanBody, cleanName,
} from "../lib/chat.js";

const DEVICE_KEY = "binder:chat:device";
const NAME_KEY = "binder:chat:name";
const readKey = (sid) => `binder:chat:read:${sid}`;
const EMPTY = [];

function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: lives for this tab only */ }
}
function deviceId() {
  let id = lsGet(DEVICE_KEY);
  if (!id) {
    id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    lsSet(DEVICE_KEY, id);
  }
  return id;
}
const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));

export function useChat(scenarioId, enabled) {
  const me = useMemo(() => deviceId(), []);
  const [name, setNameState] = useState(() => lsGet(NAME_KEY) || "");
  // Tagged with the scenario they belong to, so switching scenarios shows an
  // empty list until the new one loads, without resetting state in an effect.
  const [store, setStore] = useState({ sid: null, list: [] });
  const [status, setStatus] = useState({ sid: null, value: "loading" }); // loading | ok | offline | unavailable
  const [readMap, setReadMap] = useState({});
  const [arrivals, setArrivals] = useState([]); // rows to pop up
  const [open, setOpen] = useState(false);
  const [sendError, setSendError] = useState(null);

  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  const seenRef = useRef(new Set());
  const catchUpRef = useRef(() => {});

  const all = store.sid === scenarioId ? store.list : EMPTY;
  const messages = useMemo(() => todaysMessages(all), [all]);
  const lastRead = scenarioId ? (readMap[scenarioId] ?? lsGet(readKey(scenarioId))) : null;
  const unread = open ? 0 : unreadCount(messages, me, lastRead);
  const chatStatus = status.sid === scenarioId ? status.value : "loading";

  const markRead = useCallback((sid, iso) => {
    if (!sid || !iso) return;
    setReadMap((cur) => {
      const prev = cur[sid] ?? lsGet(readKey(sid));
      if (prev && Date.parse(prev) >= Date.parse(iso)) return cur;
      lsSet(readKey(sid), iso);
      return { ...cur, [sid]: iso };
    });
  }, []);

  useEffect(() => {
    if (!enabled || !scenarioId) return;
    const sid = scenarioId;
    let alive = true;
    seenRef.current = new Set();
    const merge = (rows) => {
      for (const r of rows) seenRef.current.add(r.id);
      setStore((cur) => ({ sid, list: mergeMessages(cur.sid === sid ? cur.list : [], rows) }));
    };
    const catchUp = async () => {
      try {
        const rows = await remoteListChat(sid, startOfDay().toISOString());
        if (!alive) return;
        merge(rows);
        setStatus({ sid, value: "ok" });
      } catch (e) {
        if (!alive) return;
        setStatus({ sid, value: e instanceof ChatUnavailable ? "unavailable" : "offline" });
      }
    };
    catchUpRef.current = catchUp;
    const unsub = subscribeChat(
      sid,
      (row) => {
        if (!alive) return;
        const isNew = !seenRef.current.has(row.id);
        merge([row]);
        if (openRef.current) markRead(sid, row.created_at);
        else if (isNew && row.author_id !== me) setArrivals((a) => [...a, row].slice(-2));
      },
      catchUp
    );
    catchUp();
    // Coming back to the tab after a sleep: the socket may have dropped quietly.
    const onFocus = () => catchUp();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      unsub();
      window.removeEventListener("focus", onFocus);
      setArrivals([]); // async-safe: runs on scenario switch, not during render
    };
  }, [scenarioId, enabled, me, markRead]);

  const show = useCallback(() => {
    openRef.current = true;
    setOpen(true);
    setArrivals([]);
    setSendError(null);
    markRead(scenarioId, latestTime(messages));
    catchUpRef.current();
  }, [markRead, scenarioId, messages]);
  const hide = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    markRead(scenarioId, latestTime(messages));
  }, [markRead, scenarioId, messages]);
  const toggle = useCallback(() => (openRef.current ? hide() : show()), [hide, show]);

  const setName = useCallback((v) => {
    const n = cleanName(v);
    if (!n) return;
    lsSet(NAME_KEY, n);
    setNameState(n);
  }, []);

  // Resolves true once stored; on failure the message is withdrawn and the
  // caller keeps the draft so nothing typed is lost.
  const send = useCallback(async (text) => {
    const body = cleanBody(text);
    const sid = scenarioId;
    if (!body || !name || !sid) return false;
    const row = { id: newId(), scenario_id: sid, author_id: me, author_name: name, body };
    seenRef.current.add(row.id);
    setSendError(null);
    setStore((cur) => ({ sid, list: mergeMessages(cur.sid === sid ? cur.list : [], [{ ...row, created_at: new Date().toISOString(), pending: true }]) }));
    try {
      const saved = await remoteSendChat(row);
      setStore((cur) => (cur.sid === sid ? { sid, list: mergeMessages(cur.list, [saved]) } : cur));
      markRead(sid, saved.created_at);
      return true;
    } catch (e) {
      setStore((cur) => (cur.sid === sid ? { sid, list: cur.list.filter((m) => m.id !== row.id) } : cur));
      setSendError(e instanceof ChatUnavailable
        ? "chat isn't set up on the server yet."
        : "couldn't send. check your connection and try again.");
      return false;
    }
  }, [scenarioId, name, me, markRead]);

  const dismiss = useCallback((id) => setArrivals((a) => a.filter((r) => r.id !== id)), []);

  return {
    enabled: !!enabled && !!scenarioId,
    me, name, setName,
    messages, unread, status: chatStatus,
    open, show, hide, toggle,
    arrivals, dismiss,
    send, sendError,
  };
}
