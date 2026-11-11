import { createClient } from '@supabase/supabase-js';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { VideoSignal } from './webcam';

export type Identity = { id: string; name: string; color: string };
export type Pose = { x: number; y: number; z: number; yaw: number; moving: boolean; running: boolean; grounded: boolean };
export type PlayerState = Pose & { id: string; seq: number };
export type ChatMessage = { id: string; name: string; text: string; own: boolean };
type ChatPacket = { id: string; from: string; text: string };
type Hooks = {
  status: (status: string) => void;
  members: (members: Identity[]) => void;
  state: (identity: Identity, state: PlayerState) => void;
  remove: (id: string) => void;
  signal: (signal: VideoSignal) => void;
  chat: (message: ChatMessage) => void;
  chatReady: (ready: boolean) => void;
};

export const multiplayerConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const idPattern = /^[a-zA-Z0-9-]{1,64}$/;
export function readIdentity(value: unknown): Identity | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.id !== 'string' || !idPattern.test(data.id) || typeof data.name !== 'string' || data.name.length > 24 || typeof data.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(data.color)) return null;
  const name = data.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return name ? { id: data.id, name, color: data.color } : null;
}
export function readState(value: unknown): PlayerState | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.id !== 'string' || !idPattern.test(data.id) || !Number.isSafeInteger(data.seq) || Number(data.seq) < 0 || typeof data.moving !== 'boolean') return null;
  for (const key of ['x', 'y', 'z', 'yaw']) if (typeof data[key] !== 'number' || !Number.isFinite(data[key])) return null;
  if (Math.abs(Number(data.x)) > 9.5 || Math.abs(Number(data.z)) > 9.5 || Number(data.y) < 0 || Number(data.y) > 6 || Math.abs(Number(data.yaw)) > Math.PI * 2) return null;
  if (data.running !== undefined && typeof data.running !== 'boolean' || data.grounded !== undefined && typeof data.grounded !== 'boolean') return null;
  return { id: data.id, seq: Number(data.seq), x: Number(data.x), y: Number(data.y), z: Number(data.z), yaw: Number(data.yaw), moving: data.moving, running: data.running === true, grounded: data.grounded !== false };
}

export function joinLobby(identity: Identity, pose: () => Pose, hooks: Hooks) {
  const client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { heartbeatIntervalMs: 5000 },
  });
  const members = new Map<string, Identity>();
  const received = new Map<string, { seq: number; time: number; window: number; count: number }>();
  const pendingChat = new Map<string, { payload: ChatPacket; time: number }>();
  const channel: RealtimeChannel = client.channel('lobby-001', {
    config: { private: false, broadcast: { self: false, ack: false }, presence: { key: identity.id } },
  });
  let ready = false;
  let disposed = false;
  let seq = 0;
  let lastSent = 0;
  let lastRequest = 0;
  let previous = '';
  let tracking = false;
  let lastTrack = 0;
  async function trackIdentity() {
    if (disposed || tracking || channel.state !== 'joined') return;
    tracking = true;
    lastTrack = Date.now();
    const result = await channel.track(identity);
    tracking = false;
    if (disposed || channel.state !== 'joined') return;
    ready = result === 'ok';
    hooks.chatReady(ready);
    hooks.status(ready ? 'Connected' : 'Presence failed · retrying');
    if (ready) { sendState(true); requestStates(); }
  }
  function sendState(force = false) {
    if (!ready || disposed) return;
    const state = pose();
    const signature = JSON.stringify(state);
    const now = Date.now();
    if (!force && signature === previous && now - lastSent < 2000) return;
    previous = signature;
    lastSent = now;
    void channel.send({ type: 'broadcast', event: 'state', payload: { ...state, id: identity.id, seq: ++seq } });
  }
  function requestStates() {
    if (!ready || Date.now() - lastRequest < 500) return;
    lastRequest = Date.now();
    void channel.send({ type: 'broadcast', event: 'snapshot-request', payload: { id: identity.id } });
  }
  function clearRemotes() {
    for (const id of members.keys()) hooks.remove(id);
    members.clear();
    received.clear();
    pendingChat.clear();
    hooks.members([]);
  }
  channel.on('presence', { event: 'sync' }, () => {
    if (disposed) return;
    const next = new Map<string, Identity>();
    for (const values of Object.values(channel.presenceState())) {
      for (const value of values) {
        const member = readIdentity(value);
        if (member && member.id !== identity.id) next.set(member.id, member);
      }
    }
    let added = false;
    for (const id of members.keys()) if (!next.has(id)) { hooks.remove(id); received.delete(id); }
    for (const id of next.keys()) if (!members.has(id)) added = true;
    members.clear();
    for (const [id, member] of next) members.set(id, member);
    // Broadcast may arrive before the sender's Presence sync, especially on reconnect.
    for (const [id, message] of pendingChat) {
      if (Date.now() - message.time > 5000) pendingChat.delete(id);
      else if (members.has(message.payload.from)) {
        pendingChat.delete(id);
        receiveChat(message.payload, false);
      }
    }
    hooks.members([...members.values()]);
    if (added) { sendState(true); requestStates(); }
  });
  channel.on('broadcast', { event: 'snapshot-request' }, ({ payload }) => {
    if (disposed || !ready) return;
    if (payload && typeof payload.id === 'string' && members.has(payload.id) && Date.now() - lastSent >= 100) sendState(true);
  });
  channel.on('broadcast', { event: 'state' }, ({ payload }) => {
    if (disposed || !ready) return;
    const state = readState(payload);
    if (!state || state.id === identity.id) return;
    const member = members.get(state.id);
    if (!member) return;
    const now = Date.now();
    const last = received.get(state.id);
    if (last && state.seq <= last.seq) return;
    const inWindow = last && now - last.window < 1000;
    const count = inWindow ? last.count + 1 : 1;
    if (count > 30) return;
    received.set(state.id, { seq: state.seq, time: now, window: inWindow ? last.window : now, count });
    hooks.state(member, state);
  });
  const signalRates = new Map<string, { time: number; count: number }>();
  const chatRates = new Map<string, { time: number; count: number }>();
  const chatIds = new Set<string>();
  let lastChat = 0;
  function rememberChat(id: string) {
    chatIds.add(id);
    if (chatIds.size > 200) chatIds.delete(chatIds.values().next().value!);
  }
  function cleanText(text: string) { return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim(); }
  function receiveChat(value: unknown, canQueue = true) {
    if (!ready || disposed || !value || typeof value !== 'object') return;
    const data = value as Partial<ChatPacket>;
    if (typeof data.from !== 'string' || !idPattern.test(data.from) || data.from === identity.id || typeof data.id !== 'string' || !idPattern.test(data.id) || chatIds.has(data.id) || typeof data.text !== 'string' || data.text.length > 300) return;
    const payload: ChatPacket = { from: data.from, id: data.id, text: data.text };
    const text = cleanText(payload.text);
    if (!text) return;
    const member = members.get(payload.from);
    if (!member) {
      if (canQueue && !pendingChat.has(payload.id) && pendingChat.size < 20) pendingChat.set(payload.id, { payload, time: Date.now() });
      return;
    }
    const now = Date.now();
    const previous = chatRates.get(payload.from);
    const inWindow = previous && now - previous.time < 5000;
    const count = inWindow ? previous.count + 1 : 1;
    if (count > 6) return;
    chatRates.set(payload.from, { time: inWindow ? previous.time : now, count });
    rememberChat(payload.id);
    hooks.chat({ id: payload.id, name: member.name, text, own: false });
  }
  channel.on('broadcast', { event: 'chat' }, ({ payload }) => receiveChat(payload));
  channel.on('broadcast', { event: 'video-signal' }, ({ payload }) => {
    if (disposed || !ready || !payload || payload.to !== identity.id || !members.has(payload.from)) return;
    // Limit signaling separately from movement; SDP and ICE never carry video frames.
    if (JSON.stringify(payload).length > 20000) return;
    const now = Date.now();
    const rate = signalRates.get(payload.from);
    const count = rate && now - rate.time < 1000 ? rate.count + 1 : 1;
    if (count > 100) return;
    signalRates.set(payload.from, { time: count === 1 ? now : rate!.time, count });
    if (payload.description && (!['offer', 'answer'].includes(payload.description.type) || typeof payload.description.sdp !== 'string')) return;
    if (payload.candidate && typeof payload.candidate.candidate !== 'string') return;
    hooks.signal(payload as VideoSignal);
  });
  hooks.status('Connecting…');
  channel.subscribe(status => {
    if (disposed) return;
    if (status === 'SUBSCRIBED') {
      void trackIdentity();
    } else {
      ready = false;
      hooks.chatReady(false);
      clearRemotes();
      hooks.status('Reconnecting…');
    }
  });
  const timer = window.setInterval(() => {
    for (const [id, message] of pendingChat) if (Date.now() - message.time > 5000) pendingChat.delete(id);
    if (!ready && Date.now() - lastTrack > 2000) void trackIdentity();
    sendState();
    for (const [id, last] of received) {
      if (Date.now() - last.time > 20000) hooks.remove(id);
    }
    // Retry snapshots for members whose initial broadcast arrived before Presence.
    if ([...members.keys()].some(id => !received.has(id))) requestStates();
  }, 100);
  return {
    async chat(raw: string): Promise<string | null> {
      if (!ready || disposed) return 'Chat is disconnected. Please wait and retry.';
      const text = cleanText(raw);
      if (!text) return 'Please enter a message.';
      if (text.length > 300) return 'Use 300 characters or fewer.';
      if (Date.now() - lastChat < 1000) return 'Please wait a moment before sending again.';
      lastChat = Date.now();
      const id = crypto.randomUUID();
      const result = await channel.send({ type: 'broadcast', event: 'chat', payload: { id, from: identity.id, text } });
      if (disposed || !ready || result !== 'ok') return 'Message could not be sent. Please retry.';
      rememberChat(id);
      hooks.chat({ id, name: identity.name, text, own: true });
      return null;
    },
    signal(signal: VideoSignal) {
      if (ready && !disposed && signal.from === identity.id && members.has(signal.to)) {
        void channel.send({ type: 'broadcast', event: 'video-signal', payload: signal });
      }
    },
    dispose() {
      disposed = true;
      hooks.chatReady(false);
      ready = false;
      clearInterval(timer);
      clearRemotes();
      void client.removeChannel(channel);
    },
  };
}
