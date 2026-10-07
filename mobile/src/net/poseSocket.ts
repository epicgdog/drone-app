export type PoseStatus = "ok" | "no_person" | "error";

export interface PoseMessage {
  type: "pose";
  frame_id: number;
  status: PoseStatus;
  joints: number[][] | null;
  joints_root_rel: number[][] | null;
  scores: number[] | null;
  image_size: [number, number] | null;
  timing_ms: {
    decode: number;
    prepare_2d: number;
    pose_3d: number;
    total: number;
  };
  error: string | null;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface PoseSocketStats {
  sentPerSec: number;
  recvPerSec: number;
  lastRttMs: number | null;
  lastServerTotalMs: number | null;
  lastStatus: PoseStatus | null;
}

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 5000;
const SEND_TIMEOUT_MS = 2000;
const STATS_WINDOW_MS = 2000;

interface PendingFrame {
  resolve: (msg: PoseMessage | null) => void;
  timer: ReturnType<typeof setTimeout>;
  sentAt: number;
}

export class PoseSocket {
  private url: string;
  private ws: WebSocket | null = null;
  private manualClose = false;
  private backoffMs = MIN_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private status: ConnectionStatus = "disconnected";
  private statusListeners = new Set<(status: ConnectionStatus) => void>();

  private pending = new Map<number, PendingFrame>();
  private sentTimestamps: number[] = [];
  private recvTimestamps: number[] = [];
  private lastRttMs: number | null = null;
  private lastServerTotalMs: number | null = null;
  private lastStatus: PoseStatus | null = null;

  constructor(url: string) {
    this.url = url;
  }

  setUrl(url: string): void {
    if (this.url === url) return;
    this.url = url;
    this.reconnect();
  }

  onStatusChange(cb: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  connect(): void {
    this.manualClose = false;
    this.openSocket();
  }

  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.setStatus("disconnected");
  }

  private reconnect(): void {
    this.disconnect();
    this.connect();
  }

  private openSocket(): void {
    this.setStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.backoffMs = MIN_BACKOFF_MS;
      this.setStatus("connected");
    };

    ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    ws.onerror = () => {
      // onclose follows; reconnection is scheduled there.
    };

    ws.onclose = () => {
      this.ws = null;
      this.setStatus("disconnected");
      this.failAllPending();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.manualClose) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.openSocket();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((cb) => cb(status));
  }

  private handleMessage(raw: string): void {
    let msg: PoseMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const now = Date.now();
    this.recvTimestamps.push(now);
    this.pruneWindow(this.recvTimestamps, now);
    this.lastServerTotalMs = msg.timing_ms?.total ?? null;
    this.lastStatus = msg.status;

    const pending = this.pending.get(msg.frame_id);
    if (pending) {
      clearTimeout(pending.timer);
      this.lastRttMs = now - pending.sentAt;
      this.pending.delete(msg.frame_id);
      pending.resolve(msg);
    }
  }

  private failAllPending(): void {
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.resolve(null);
    });
    this.pending.clear();
  }

  sendFrame(frameId: number, jpeg: ArrayBuffer): Promise<PoseMessage | null> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const header = new Uint8Array(4);
      new DataView(header.buffer).setUint32(0, frameId, false);

      const payload = new Uint8Array(header.length + jpeg.byteLength);
      payload.set(header, 0);
      payload.set(new Uint8Array(jpeg), header.length);

      const timer = setTimeout(() => {
        this.pending.delete(frameId);
        resolve(null);
      }, SEND_TIMEOUT_MS);

      this.pending.set(frameId, { resolve, timer, sentAt: Date.now() });

      const now = Date.now();
      this.sentTimestamps.push(now);
      this.pruneWindow(this.sentTimestamps, now);

      ws.send(payload.buffer);
    });
  }

  private pruneWindow(timestamps: number[], now: number): void {
    while (timestamps.length > 0 && now - timestamps[0] > STATS_WINDOW_MS) {
      timestamps.shift();
    }
  }

  getStats(): PoseSocketStats {
    const now = Date.now();
    this.pruneWindow(this.sentTimestamps, now);
    this.pruneWindow(this.recvTimestamps, now);
    return {
      sentPerSec: this.sentTimestamps.length / (STATS_WINDOW_MS / 1000),
      recvPerSec: this.recvTimestamps.length / (STATS_WINDOW_MS / 1000),
      lastRttMs: this.lastRttMs,
      lastServerTotalMs: this.lastServerTotalMs,
      lastStatus: this.lastStatus,
    };
  }
}
