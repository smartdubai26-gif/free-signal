import { WebSocket } from 'ws';

export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'STALE' | 'RECONNECTING' | 'DISCONNECTED';

export class TwelveDataWebSocket {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private reconnectAttempts = 0;
  private readonly maxReconnectDelay = 30000;
  private readonly apiKey: string;
  private readonly onMessage: (data: any) => void;
  private readonly onStateChange: (state: ConnectionState) => void;
  private readonly onReconnectRecovery?: (disconnectStart: number, reconnectedAt: number) => void;
  private lastMessageTime: number = 0;
  private staleTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly staleThreshold = 10000; // 10 seconds
  private isExplicitlyClosed: boolean = false;
  private disconnectStartTime: number | null = null;

  private subscribedSymbols: Set<string> = new Set();

  constructor(
    apiKey: string,
    onMessage: (data: any) => void,
    onStateChange: (state: ConnectionState) => void,
    onReconnectRecovery?: (disconnectStart: number, reconnectedAt: number) => void
  ) {
    this.apiKey = apiKey;
    this.onMessage = onMessage;
    this.onStateChange = onStateChange;
    this.onReconnectRecovery = onReconnectRecovery;
  }

  subscribe(symbols: string[]) {
    symbols.forEach(s => this.subscribedSymbols.add(s));
    if (this.state === 'CONNECTED') {
      this.send({ action: 'subscribe', params: { symbols: symbols.join(',') } });
    }
  }

  unsubscribe(symbols: string[]) {
    symbols.forEach(s => this.subscribedSymbols.delete(s));
    if (this.state === 'CONNECTED') {
      this.send({ action: 'unsubscribe', params: { symbols: symbols.join(',') } });
    }
  }

  private resetStaleTimer() {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => this.setState('STALE'), this.staleThreshold);
  }

  connect() {
    this.isExplicitlyClosed = false;
    if (this.state === 'CONNECTED' || this.state === 'CONNECTING') return;

    this.setState('CONNECTING');
    this.ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${this.apiKey}`);

    this.ws.on('open', () => {
      const wasReconnecting = this.disconnectStartTime !== null;
      const disconnectStart = this.disconnectStartTime ?? Date.now();
      const reconnectedAt = Date.now();
      this.disconnectStartTime = null;

      this.reconnectAttempts = 0;
      this.setState('CONNECTED');
      this.resetStaleTimer();
      // Resubscribe on reconnect
      if (this.subscribedSymbols.size > 0) {
        this.send({ action: 'subscribe', params: { symbols: Array.from(this.subscribedSymbols).join(',') } });
      }

      if (wasReconnecting && this.onReconnectRecovery) {
        try {
          this.onReconnectRecovery(disconnectStart, reconnectedAt);
        } catch (err) {
          console.error('Error in onReconnectRecovery callback:', err);
        }
      }
    });

    this.ws.on('message', (data) => {
      this.lastMessageTime = Date.now();
      this.resetStaleTimer();
      try {
        this.onMessage(JSON.parse(data.toString()));
      } catch (e) {
        console.error('Failed to parse incoming WebSocket message', e);
      }
    });

    this.ws.on('close', () => {
      if (this.staleTimer) clearTimeout(this.staleTimer);
      if (!this.isExplicitlyClosed) {
        this.handleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      if (!this.isExplicitlyClosed) {
        console.error('WebSocket Error:', err);
      }
      if (this.staleTimer) clearTimeout(this.staleTimer);
      if (!this.isExplicitlyClosed) {
        this.handleReconnect();
      }
    });
  }

  private handleReconnect() {
    if (this.isExplicitlyClosed) return;
    if (this.disconnectStartTime === null) {
      this.disconnectStartTime = this.lastMessageTime > 0 ? this.lastMessageTime : Date.now();
    }
    this.setState('RECONNECTING');
    this.ws = null;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000, this.maxReconnectDelay);
    this.reconnectAttempts++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.isExplicitlyClosed) {
        this.connect();
      }
    }, delay);
  }

  private setState(state: ConnectionState) {
    this.state = state;
    this.onStateChange(state);
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  close() {
    this.isExplicitlyClosed = true;
    if (this.staleTimer) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setState('DISCONNECTED');
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
  }

  getState(): ConnectionState {
    return this.state;
  }

  getLastMessageTime(): number {
    return this.lastMessageTime;
  }

  getDisconnectStartTime(): number | null {
    return this.disconnectStartTime;
  }
}
