type TickerPayload = {
  price: number;
  changePct: number | null;
};

type Listener = (payload: TickerPayload) => void;

const STREAM_URL = "wss://stream.binance.com:9443/stream?streams=btcusdt@ticker";
const CLOSE_GRACE_MS = 2000;
const RECONNECT_DELAY_MS = 1500;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();
let lastPayload: TickerPayload | null = null;

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearCloseTimer() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function emit(payload: TickerPayload) {
  lastPayload = payload;
  listeners.forEach((listener) => listener(payload));
}

function ensureSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  clearReconnectTimer();
  ws = new WebSocket(STREAM_URL);

  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as {
        stream?: string;
        data?: Record<string, string>;
      };
      if (msg.stream !== "btcusdt@ticker" || !msg.data) return;

      const price = parseFloat(msg.data.c ?? "");
      const changePctRaw = msg.data.P;
      const changePct = changePctRaw !== undefined ? parseFloat(changePctRaw) : null;

      if (!Number.isFinite(price)) return;
      emit({
        price,
        changePct: Number.isFinite(changePct as number) ? (changePct as number) : null,
      });
    } catch {
      // Ignore malformed frames.
    }
  };

  ws.onclose = () => {
    ws = null;
    if (listeners.size > 0) {
      reconnectTimer = setTimeout(ensureSocket, RECONNECT_DELAY_MS);
    }
  };

  ws.onerror = () => {
    // Avoid noisy console output for transient close/reconnect events.
  };
}

function scheduleCloseIfIdle() {
  clearCloseTimer();
  closeTimer = setTimeout(() => {
    if (listeners.size > 0) return;
    clearReconnectTimer();
    if (ws && ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED) {
      ws.close();
    }
    ws = null;
  }, CLOSE_GRACE_MS);
}

export function subscribeBtcTicker(listener: Listener): () => void {
  clearCloseTimer();
  listeners.add(listener);

  if (lastPayload) {
    listener(lastPayload);
  }

  ensureSocket();

  return () => {
    listeners.delete(listener);
    scheduleCloseIfIdle();
  };
}
