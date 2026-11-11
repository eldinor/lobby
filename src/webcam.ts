export type VideoSignal = {
  from: string;
  to: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  camera?: boolean;
};

type Peer = {
  pc: RTCPeerConnection;
  sender: RTCRtpSender;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingAnswer: boolean;
  camera: boolean;
  stream: MediaStream | null;
  candidates: RTCIceCandidateInit[];
};

export class Webcams {
  private peers = new Map<string, Peer>();
  private local: MediaStream | null = null;
  private disposed = false;
  private generation = 0;
  private pending = false;
  private retryTimer: number;

  constructor(
    private id: string,
    private send: (signal: VideoSignal) => void,
    private show: (id: string, stream: MediaStream | null) => void,
    private status: (message: string, enabled: boolean) => void,
  ) {
    this.retryTimer = window.setInterval(() => {
      for (const [id, peer] of this.peers) {
        if (peer.pc.signalingState === 'have-local-offer' && !peer.makingOffer && peer.pc.localDescription) {
          this.send({ from: this.id, to: id, description: peer.pc.localDescription.toJSON(), camera: Boolean(this.local) });
        }
      }
    }, 3000);
  }

  members(ids: string[]) {
    for (const [id, peer] of this.peers) {
      if (!ids.includes(id)) { peer.pc.close(); this.peers.delete(id); this.show(id, null); }
    }
    if (typeof RTCPeerConnection === 'undefined') return;
    for (const id of ids) if (!this.peers.has(id)) this.createPeer(id);
  }

  private createPeer(id: string) {
    const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    // Optional browser-visible, short-lived TURN credentials; never use account secrets.
    try {
      const extra: unknown = JSON.parse(import.meta.env.VITE_WEBRTC_ICE_SERVERS || '[]');
      if (Array.isArray(extra)) servers.push(...extra);
    } catch { this.status('Invalid relay configuration', Boolean(this.local)); }
    const pc = new RTCPeerConnection({ iceServers: servers });
    const transceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
    const peer: Peer = { pc, sender: transceiver.sender, makingOffer: false, ignoreOffer: false, settingAnswer: false, camera: false, stream: null, candidates: [] };
    this.peers.set(id, peer);
    void peer.sender.replaceTrack(this.local?.getVideoTracks()[0] ?? null).catch(() => {});
    const signal = (data: Omit<VideoSignal, 'from' | 'to'>) => {
      if (!this.disposed && this.peers.get(id) === peer) this.send({ from: this.id, to: id, ...data });
    };
    pc.onicecandidate = event => { if (event.candidate) signal({ candidate: event.candidate.toJSON() }); };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        signal({ description: pc.localDescription!.toJSON(), camera: Boolean(this.local) });
      } catch { if (!this.disposed && pc.signalingState !== 'closed') this.status('Video connection retrying', Boolean(this.local)); }
      finally { peer.makingOffer = false; }
    };
    pc.ontrack = event => {
      if (this.disposed || this.peers.get(id) !== peer) return;
      peer.stream = event.streams[0] ?? new MediaStream([event.track]);
      if (peer.camera) this.show(id, peer.stream);
      event.track.onended = () => this.show(id, null);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.show(id, null);
        this.status('A video connection failed · relay may be needed', Boolean(this.local));
      }
    };
  }

  async receive(signal: VideoSignal) {
    if (this.disposed || signal.to !== this.id) return;
    const peer = this.peers.get(signal.from);
    if (!peer) return;
    const pc = peer.pc;
    try {
      if (typeof signal.camera === 'boolean') {
        peer.camera = signal.camera;
        this.show(signal.from, peer.camera ? peer.stream : null);
      }
      if (signal.description) {
        const ready = !peer.makingOffer && (pc.signalingState === 'stable' || peer.settingAnswer);
        const collision = signal.description.type === 'offer' && !ready;
        peer.ignoreOffer = this.id < signal.from && collision;
        if (peer.ignoreOffer) return;
        peer.settingAnswer = signal.description.type === 'answer';
        await pc.setRemoteDescription(signal.description);
        peer.settingAnswer = false;
        for (const candidate of peer.candidates.splice(0)) await pc.addIceCandidate(candidate);
        if (signal.description.type === 'offer') {
          await pc.setLocalDescription();
          this.send({ from: this.id, to: signal.from, description: pc.localDescription!.toJSON(), camera: Boolean(this.local) });
        }
      } else if (signal.candidate && !peer.ignoreOffer) {
        if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
        else if (peer.candidates.length < 64) peer.candidates.push(signal.candidate);
      }
    } catch {
      if (!peer.ignoreOffer && !this.disposed && pc.signalingState !== 'closed') this.status('Could not connect one video stream', Boolean(this.local));
    }
  }

  async toggle() {
    if (this.disposed || this.pending) return;
    if (this.local) { this.stopCamera(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { this.status('Camera needs HTTPS or localhost', false); return; }
    this.pending = true;
    const generation = ++this.generation;
    this.status('Requesting camera…', false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 320 }, height: { ideal: 320 }, frameRate: { ideal: 15, max: 15 }, facingMode: 'user' } });
      if (this.disposed || generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.local = stream;
      const track = stream.getVideoTracks()[0];
      track.onended = () => this.stopCamera();
      await Promise.all([...this.peers.values()].map(peer => peer.sender.replaceTrack(track)));
      if (this.disposed || generation !== this.generation) return;
      this.show(this.id, stream);
      this.broadcastCamera(true);
      this.status('Camera on · sharing with this room', true);
    } catch (error) {
      if (this.disposed) return;
      this.stopCamera();
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      this.status(denied ? 'Camera permission denied · you can retry' : 'Camera unavailable · check your device', false);
    } finally { this.pending = false; }
  }

  private broadcastCamera(camera: boolean) {
    for (const id of this.peers.keys()) this.send({ from: this.id, to: id, camera });
  }

  private stopCamera() {
    ++this.generation;
    this.local?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.local = null;
    for (const peer of this.peers.values()) void peer.sender.replaceTrack(null).catch(() => {});
    this.show(this.id, null);
    this.broadcastCamera(false);
    this.status('Camera off', false);
  }

  dispose() {
    clearInterval(this.retryTimer);
    this.stopCamera();
    this.disposed = true;
    for (const [id, peer] of this.peers) { peer.pc.close(); this.show(id, null); }
    this.peers.clear();
  }
}
