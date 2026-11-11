import { createClient } from '@supabase/supabase-js';
import { Room, RoomEvent, Track, ConnectionState } from 'livekit-client';
import type { Participant, TrackPublication, RemoteTrack, LocalTrack } from 'livekit-client';

export type MediaStatus = { connected: boolean; connecting: boolean; camera: boolean; microphone: boolean; message: string; audioBlocked: boolean };
export class LiveKitMedia {
  private room = new Room({ adaptiveStream: true, dynacast: true, stopLocalTrackOnUnpublish: true,
    publishDefaults: { stopMicTrackOnMute: true },
    videoCaptureDefaults: { resolution: { width: 320, height: 320, frameRate: 15 } },
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  private auth = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { storage: window.sessionStorage, storageKey: 'lobby-media-guest', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
  private disposed = false;
  private connecting: Promise<void> | undefined;
  private pending = false;
  private audio = new Map<string, { element: HTMLMediaElement; track: RemoteTrack }>();
  private videos = new Map<string, string>();
  private desiredCamera = false;
  private desiredMicrophone = false;
  private joinGeneration = 0;
  private connectionAbort: AbortController | undefined;

  constructor(private id: string, private name: string,
    private show: (id: string, stream: MediaStream | null) => void,
    private update: (status: MediaStatus) => void,
    private speaking: (ids: string[]) => void) {
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => this.attach(track, publication, participant));
    this.room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => this.detach(track, publication, participant));
    this.room.on(RoomEvent.TrackMuted, (publication, participant) => {
      if (publication.source === Track.Source.Camera) this.show(this.avatarId(participant), null);
    });
    this.room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      if (publication.track && publication.source === Track.Source.Camera) this.show(this.avatarId(participant), new MediaStream([publication.track.mediaStreamTrack]));
    });
    this.room.on(RoomEvent.LocalTrackPublished, publication => {
      if (publication.source === Track.Source.Camera && publication.track) this.show(this.id, new MediaStream([publication.track.mediaStreamTrack]));
    });
    this.room.on(RoomEvent.LocalTrackUnpublished, publication => { if (publication.source === Track.Source.Camera) this.show(this.id, null); });
    this.room.on(RoomEvent.ParticipantDisconnected, participant => {
      this.show(this.avatarId(participant), null);
      for (const publication of participant.audioTrackPublications.values()) if (publication.track) this.detach(publication.track, publication, participant);
    });
    this.room.on(RoomEvent.ActiveSpeakersChanged, participants => this.speaking(participants.map(participant => this.avatarId(participant))));
    this.room.on(RoomEvent.AudioPlaybackStatusChanged, () => this.notify());
    this.room.on(RoomEvent.Reconnecting, () => this.notify('Media reconnecting…'));
    this.room.on(RoomEvent.Reconnected, () => this.notify('Voice and video connected'));
    this.room.on(RoomEvent.Disconnected, () => { this.cleanupMedia(); this.notify('Media disconnected · click Join voice to retry'); });
    this.notify('Voice disconnected · join when ready');
  }

  private avatarId(participant: Participant) { return participant.identity.split(':').at(-1)!; }
  private isConnected() { return this.room.state === ConnectionState.Connected; }
  private notify(message = 'Voice and video connected') {
    if (this.disposed) return;
    this.update({ connected: this.room.state === ConnectionState.Connected, connecting: Boolean(this.connecting),
      camera: this.room.localParticipant.isCameraEnabled, microphone: this.room.localParticipant.isMicrophoneEnabled,
      message, audioBlocked: this.room.state === ConnectionState.Connected && !this.room.canPlaybackAudio });
  }
  private attach(track: RemoteTrack, publication: TrackPublication, participant: Participant) {
    if (this.disposed) return;
    const id = this.avatarId(participant);
    if (track.kind === Track.Kind.Video && publication.source === Track.Source.Camera) {
      this.videos.set(track.sid!, id);
      if (!publication.isMuted) this.show(id, new MediaStream([track.mediaStreamTrack]));
    } else if (track.kind === Track.Kind.Audio) {
      const element = track.attach();
      element.setAttribute('aria-label', `${participant.name ?? 'Participant'} audio`);
      element.dataset.participant = id;
      document.querySelector('#room-audio')!.append(element);
      this.audio.set(track.sid!, { element, track });
    }
  }
  private detach(track: RemoteTrack | LocalTrack, publication: TrackPublication, participant: Participant) {
    if (publication.source === Track.Source.Camera) { this.show(this.avatarId(participant), null); this.videos.delete(track.sid!); }
    const entry = this.audio.get(track.sid!);
    if (entry) { entry.track.detach(entry.element); entry.element.remove(); this.audio.delete(track.sid!); }
  }
  async connect() {
    if (this.disposed || this.isConnected()) return;
    if (this.connecting) return this.connecting;
    const generation = ++this.joinGeneration;
    this.connectionAbort = new AbortController();
    this.connecting = this.doConnect(generation, this.connectionAbort.signal);
    this.notify('Connecting voice and video…');
    let failure: string | undefined;
    try { await this.connecting; }
    catch (error) { failure = error instanceof Error ? error.message : 'Media connection failed'; }
    finally { this.connecting = undefined; if (!this.disposed) this.notify(failure ?? (this.room.state === ConnectionState.Connected ? 'Voice and video connected' : 'Media not connected · retry Join voice')); }
  }
  private async doConnect(generation: number, signal: AbortSignal) {
    let { data: { session } } = await this.auth.auth.getSession();
    if (!session) {
      const result = await this.auth.auth.signInAnonymously();
      if (result.error || !result.data.session) throw new Error('Enable Anonymous Sign-Ins in Supabase to join voice');
      session = result.data.session;
    } else if (session.expires_at && session.expires_at * 1000 < Date.now() + 30000) {
      const refreshed = await this.auth.auth.refreshSession();
      if (refreshed.error || !refreshed.data.session) throw new Error('Guest session expired · reload and retry');
      session = refreshed.data.session;
    }
    if (this.disposed || generation !== this.joinGeneration) return;
    const endpoint = import.meta.env.VITE_LIVEKIT_TOKEN_URL || `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/livekit-token`;
    const response = await fetch(endpoint, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ sessionId: this.id, name: this.name }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 404 ? 'Deploy the livekit-token Edge Function to enable voice' : result.error || 'Media token could not be obtained');
    if (typeof result.serverUrl !== 'string' || !result.serverUrl.startsWith('wss://') || typeof result.participantToken !== 'string') throw new Error('Invalid token service response');
    if (this.disposed || generation !== this.joinGeneration) return;
    await this.room.connect(result.serverUrl, result.participantToken);
    if (this.disposed || generation !== this.joinGeneration) { await this.room.disconnect(); return; }
    await this.room.startAudio().catch(() => {});
  }
  async toggle(source: 'camera' | 'microphone') {
    if (this.pending || this.disposed) return;
    this.pending = true;
    try {
      await this.connect();
      if (this.disposed || this.room.state !== ConnectionState.Connected) return;
      if (source === 'camera') {
        this.desiredCamera = !this.room.localParticipant.isCameraEnabled;
        await this.room.localParticipant.setCameraEnabled(this.desiredCamera);
        if (!this.desiredCamera) this.show(this.id, null);
      } else {
        this.desiredMicrophone = !this.room.localParticipant.isMicrophoneEnabled;
        await this.room.localParticipant.setMicrophoneEnabled(this.desiredMicrophone);
      }
      if (this.disposed) { await this.room.disconnect(true); return; }
      this.notify();
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      this.notify(denied ? `${source === 'camera' ? 'Camera' : 'Microphone'} permission denied · you can retry` : `${source === 'camera' ? 'Camera' : 'Microphone'} unavailable · check your device`);
    } finally { this.pending = false; }
  }
  async startAudio() { await this.room.startAudio().catch(() => {}); this.notify(); }
  private cleanupMedia() {
    this.show(this.id, null);
    for (const id of this.videos.values()) this.show(id, null);
    this.videos.clear();
    for (const entry of this.audio.values()) { entry.track.detach(entry.element); entry.element.remove(); }
    this.audio.clear();
    this.speaking([]);
  }
  leave() {
    ++this.joinGeneration;
    this.connectionAbort?.abort();
    for (const publication of this.room.localParticipant.trackPublications.values()) publication.track?.stop();
    void this.room.disconnect(true);
    this.cleanupMedia();
    this.notify('Voice disconnected · join when ready');
  }
  dispose() { this.leave(); this.disposed = true; this.room.removeAllListeners(); }
}
