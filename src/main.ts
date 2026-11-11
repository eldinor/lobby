import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Collisions/collisionCoordinator';
import { joinLobby, multiplayerConfigured } from './multiplayer';
import type { Identity, PlayerState } from './multiplayer';
import { MovementController } from './movement';
import { createAvatar } from './avatar';
import { Webcams } from './webcam';
import { RoomChat } from './chat';
import { createChatScreen } from './chat-screen';
import { LiveKitMedia } from './livekit-media';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const enter = document.querySelector<HTMLButtonElement>('#enter-button')!;
const label = document.querySelector<HTMLDivElement>('#name-label')!;
const position = document.querySelector<HTMLOutputElement>('#position')!;

function start() {
  const engine = new Engine(canvas, true, { stencil: true });
  engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString('#e9e9e5ff');
  scene.collisionsEnabled = true;
  const light = new HemisphericLight('sky', new Vector3(-0.4, 1, -0.3), scene);
  light.intensity = 1.15;
  light.groundColor = Color3.FromHexString('#777d70');
  function material(name: string, hex: string) {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = Color3.FromHexString(hex);
    mat.specularColor = Color3.Black();
    return mat;
  }
  const floorMat = material('concrete', '#b9bcb2');
  const wallMat = material('walls', '#d2d3ca');
  const blockMat = material('blocks', '#989f92');
  const darkMat = material('display', '#606b60');
  const gridMat = material('grid', '#a8afa0');
  function box(name: string, x: number, y: number, z: number, width: number, height: number, depth: number, mat = wallMat) {
    const mesh = CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    mesh.material = mat;
    mesh.checkCollisions = true;
    return mesh;
  }
  box('floor', 0, -0.15, 0, 20.5, 0.3, 20.5, floorMat);
  box('north wall', 0, 1.6, -10, 20.5, 3.2, 0.3);
  box('west wall', -10, 1.6, 0, 0.3, 3.2, 20.5);
  // Low foreground walls preserve the view while enclosing the walking space.
  box('east parapet', 10, 0.4, 0, 0.3, 0.8, 20.5);
  box('entrance left', -6, 0.4, 10, 8, 0.8, 0.3);
  box('entrance right', 6, 0.4, 10, 8, 0.8, 0.3);
  box('display', 1, 1.65, -9.78, 6.4, 2.7, 0.15, darkMat);
  const chatScreen = createChatScreen(scene);
  box('bench west', -7.4, 0.45, -3, 1.5, 0.9, 4, blockMat);
  box('bench north', -5.8, 0.45, -6, 4.7, 0.9, 1.4, blockMat);
  box('table', -5.2, 0.3, -3.2, 1.5, 0.6, 1.5, blockMat);
  box('interaction plinth', 7, 0.6, -6.8, 1.5, 1.2, 1.5, blockMat);
  for (let i = -9; i <= 9; i++) {
    box(`grid x ${i}`, i, 0.006, 0, 0.015, 0.01, 19.7, gridMat).checkCollisions = false;
    box(`grid z ${i}`, 0, 0.006, i, 19.7, 0.01, 0.015, gridMat).checkCollisions = false;
  }
  const meeting = CreateGround('meeting area', { width: 5, height: 5 }, scene);
  meeting.position.y = 0.015;
  meeting.material = material('meeting area', '#c8ccc0');
  const avatar = CreateCapsule('local avatar', { height: 1.65, radius: 0.32, tessellation: 12 }, scene);
  avatar.material = material('avatar', '#667b68');
  avatar.position.set(0, 0.85, 5);
  avatar.rotation.y = Math.PI;
  avatar.ellipsoid.set(0.34, 0.8, 0.34);
  const controller = new MovementController(avatar);
  const localFigure = createAvatar(avatar, avatar.material, darkMat);
  const camera = new ArcRotateCamera('follow', Math.PI / 2, 0.95, 8, new Vector3(0, 1.1, 5), scene);
  camera.lowerRadiusLimit = 3;
  camera.upperRadiusLimit = 12;
  camera.lowerBetaLimit = 0.3;
  camera.upperBetaLimit = 1.35;
  camera.wheelPrecision = 35;
  camera.minZ = 0.1;
  camera.checkCollisions = true;
  camera.collisionRadius = new Vector3(0.25, 0.25, 0.25);
  camera.panningSensibility = 0;
  camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
  let joined = false;
  let moving = false;
  let network: ReturnType<typeof joinLobby> | undefined;
  let webcams: Webcams | undefined;
  let liveMedia: LiveKitMedia | undefined;
  const useLiveKit = import.meta.env.VITE_MEDIA_PROVIDER === 'livekit';
  const voiceJoin = document.querySelector<HTMLButtonElement>('#voice-join')!;
  const microphoneButton = document.querySelector<HTMLButtonElement>('#microphone-toggle')!;
  const listenButton = document.querySelector<HTMLButtonElement>('#audio-enable')!;
  const voiceStatus = document.querySelector<HTMLElement>('#voice-status')!;
  document.querySelector<HTMLElement>('#voice-controls')!.hidden = !useLiveKit;
  const cameraButton = document.querySelector<HTMLButtonElement>('#camera-toggle')!;
  const cameraStatus = document.querySelector<HTMLElement>('#camera-status')!;
  const discs = new Map<string, HTMLDivElement>();
  function showVideo(id: string, stream: MediaStream | null) {
    const previous = discs.get(id);
    if (previous) {
      const video = previous.querySelector('video')!;
      if (video.srcObject === stream) return;
      video.pause();
      video.srcObject = null;
      previous.remove();
      discs.delete(id);
    }
    if (!stream) return;
    const disc = document.createElement('div');
    disc.className = `video-disc${id === identity.id ? ' local-video' : ''}`;
    disc.dataset.session = id;
    disc.hidden = true;
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.setAttribute('aria-label', id === identity.id ? 'Your webcam' : 'Participant webcam');
    video.srcObject = stream;
    disc.append(video);
    document.querySelector('main')!.append(disc);
    discs.set(id, disc);
    void video.play().catch(() => { cameraStatus.textContent = 'Video playback could not start'; });
  }
  const identity: Identity = { id: crypto.randomUUID(), name: '', color: '#667b68' };
  const status = document.querySelector<HTMLElement>('#network-status')!;
  const participants = document.querySelector<HTMLUListElement>('#participants')!;
  const remotes = new Map<string, {
    mesh: ReturnType<typeof CreateCapsule>;
    mat: StandardMaterial;
    label: HTMLDivElement;
    samples: (PlayerState & { time: number })[];
    figure: ReturnType<typeof createAvatar>;
  }>();
  function removeRemote(id: string) {
    const remote = remotes.get(id);
    if (!remote) return;
    remote.mesh.dispose(false, false);
    remote.mat.dispose();
    remote.label.remove();
    remotes.delete(id);
  }
  function receiveRemote(member: Identity, state: PlayerState) {
    let remote = remotes.get(member.id);
    if (!remote) {
      const mesh = CreateCapsule(`remote-${member.id}`, { height: 1.65, radius: 0.32, tessellation: 12 }, scene);
      const mat = material(`color-${member.id}`, member.color);
      mesh.material = mat;
      mesh.position.set(state.x, state.y, state.z);
      mesh.rotation.y = state.yaw;
      const figure = createAvatar(mesh, mat, darkMat);
      const remoteLabel = document.createElement('div');
      remoteLabel.className = 'name-label remote-label';
      remoteLabel.dataset.session = member.id;
      remoteLabel.textContent = member.name;
      document.querySelector('main')!.append(remoteLabel);
      remote = { mesh, mat, label: remoteLabel, samples: [], figure };
      remotes.set(member.id, remote);
    }
    remote.samples.push({ ...state, time: performance.now() });
    if (remote.samples.length > 12) remote.samples.shift();
  }
  function projectLabel(element: HTMLElement, world: Vector3) {
    const projected = Vector3.Project(world.add(new Vector3(0, 1.25, 0)), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    element.hidden = projected.z < 0 || projected.z > 1;
    element.style.transform = `translate(${projected.x * canvas.clientWidth / engine.getRenderWidth()}px, ${projected.y * canvas.clientHeight / engine.getRenderHeight()}px) translate(-50%, -100%)`;
  }
  if (!multiplayerConfigured) document.querySelector('#join-note')!.textContent = 'Local preview · add Supabase settings to enable multiplayer.';
  const keys = new Set<string>();
  const clearKeys = () => { keys.clear(); controller.stop(); };
  const chat = new RoomChat(text => network?.chat(text) ?? Promise.resolve('Chat needs a room connection.'), clearKeys, () => canvas.focus());
  window.addEventListener('keydown', event => {
    if (!joined || event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLElement && (event.target.isContentEditable || ['BUTTON', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space'].includes(event.code)) {
      if (event.code === 'Space' && !event.repeat && !keys.has('Space')) controller.jump();
      keys.add(event.code);
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', clearKeys);
  document.addEventListener('visibilitychange', clearKeys);
  document.querySelector<HTMLFormElement>('#join-form')!.addEventListener('submit', event => {
    event.preventDefault();
    const name = document.querySelector<HTMLInputElement>('#display-name')!.value.trim().replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 24);
    if (!name) { document.querySelector<HTMLInputElement>('#display-name')!.focus(); return; }
    label.textContent = name;
    document.querySelector('#player-name')!.textContent = name;
    document.querySelector<HTMLElement>('#join-panel')!.hidden = true;
    document.querySelector<HTMLElement>('#session-panel')!.hidden = false;
    joined = true;
    chat.session(true);
    chatScreen.clear();
    controller.reset();
    avatar.position.set(0, 0.85, 5);
    identity.id = crypto.randomUUID();
    identity.name = name;
    if (useLiveKit) liveMedia = new LiveKitMedia(identity.id, name, showVideo, state => {
      cameraStatus.textContent = state.camera ? 'Camera on · sharing with this room' : 'Camera off';
      cameraButton.textContent = state.camera ? 'Turn camera off' : 'Turn camera on';
      cameraButton.setAttribute('aria-pressed', String(state.camera));
      microphoneButton.textContent = state.microphone ? 'Mute microphone' : 'Unmute microphone';
      microphoneButton.setAttribute('aria-pressed', String(state.microphone));
      voiceJoin.textContent = state.connected ? 'Leave voice' : state.connecting ? 'Connecting…' : 'Join voice';
      voiceJoin.disabled = state.connecting;
      voiceJoin.dataset.connected = String(state.connected);
      voiceStatus.textContent = state.message;
      listenButton.hidden = !state.audioBlocked;
    }, ids => {
      label.classList.toggle('speaking', ids.includes(identity.id));
      for (const [id, remote] of remotes) remote.label.classList.toggle('speaking', ids.includes(id));
      for (const [id, disc] of discs) disc.classList.toggle('speaking', ids.includes(id));
    });
    else webcams = new Webcams(identity.id, signal => network?.signal(signal), showVideo, (message, enabled) => {
      cameraStatus.textContent = message;
      cameraButton.textContent = enabled ? 'Turn camera off' : 'Turn camera on';
      cameraButton.setAttribute('aria-pressed', String(enabled));
    });
    if (multiplayerConfigured) {
      avatar.position.x = (Math.random() - 0.5) * 3;
      network = joinLobby(identity, () => ({
        x: Number(avatar.position.x.toFixed(3)), y: Number(avatar.position.y.toFixed(3)), z: Number(avatar.position.z.toFixed(3)),
        yaw: Math.atan2(Math.sin(avatar.rotation.y), Math.cos(avatar.rotation.y)), moving, running: controller.running, grounded: controller.grounded,
      }), {
        status: message => { status.textContent = message; },
        members: members => {
          webcams?.members(members.map(member => member.id));
          document.querySelector('#online-count')!.textContent = `${members.length + 1} in room`;
          participants.replaceChildren();
          for (const member of members) {
            const item = document.createElement('li');
            item.textContent = member.name;
            participants.append(item);
          }
        },
        state: receiveRemote,
        remove: removeRemote,
        signal: signal => { void webcams?.receive(signal); },
        chat: message => { chat.receive(message); chatScreen.receive(message); },
        chatReady: ready => chat.connection(ready),
      });
    } else { status.textContent = 'Local preview'; }
    camera.attachControl(canvas, true);
    canvas.focus();
  });
  document.querySelector('#leave')!.addEventListener('click', () => {
    liveMedia?.dispose();
    liveMedia = undefined;
    webcams?.dispose();
    webcams = undefined;
    network?.dispose();
    network = undefined;
    joined = false;
    chat.session(false);
    chatScreen.clear();
    moving = false;
    clearKeys();
    camera.detachControl();
    label.hidden = true;
    document.querySelector<HTMLElement>('#session-panel')!.hidden = true;
    document.querySelector<HTMLElement>('#join-panel')!.hidden = false;
    document.querySelector<HTMLInputElement>('#display-name')!.focus();
  });
  cameraButton.addEventListener('click', () => { if (liveMedia) void liveMedia.toggle('camera'); else void webcams?.toggle(); });
  microphoneButton.addEventListener('click', () => { void liveMedia?.toggle('microphone'); });
  voiceJoin.addEventListener('click', () => { if (voiceJoin.dataset.connected === 'true') liveMedia?.leave(); else void liveMedia?.connect(); });
  listenButton.addEventListener('click', () => { void liveMedia?.startAudio(); });
  window.addEventListener('pagehide', () => { liveMedia?.dispose(); webcams?.dispose(); network?.dispose(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  document.querySelector('#reset')!.addEventListener('click', () => {
    avatar.position.set(0, 0.85, 5);
    avatar.rotation.y = Math.PI;
    controller.reset();
    camera.alpha = Math.PI / 2;
    camera.beta = 0.95;
    camera.radius = 8;
    clearKeys();
    canvas.focus();
  });
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
    if (joined) {
      const forward = camera.target.subtract(camera.position);
      forward.y = 0;
      forward.normalize();
      const right = Vector3.Cross(Vector3.Up(), forward).normalize();
      const movement = forward.scale(Number(keys.has('KeyW')) - Number(keys.has('KeyS')))
        .add(right.scale(Number(keys.has('KeyD')) - Number(keys.has('KeyA'))));
      if (movement.lengthSquared() > 0) {
        movement.normalize();
        const angle = Math.atan2(movement.x, movement.z);
        const delta = Math.atan2(Math.sin(angle - avatar.rotation.y), Math.cos(angle - avatar.rotation.y));
        avatar.rotation.y += delta * (1 - Math.exp(-14 * dt));
      }
      controller.update(dt, movement, keys.has('ShiftLeft') || keys.has('ShiftRight'));
      moving = Math.hypot(controller.velocity.x, controller.velocity.z) > 0.05 || !controller.grounded;
      localFigure.update(dt, moving, controller.running, controller.grounded);
      const cameraTarget = avatar.position.add(new Vector3(0, 0.35, 0));
      // Follow horizontal travel immediately and soften the vertical jump arc.
      camera.target.x = cameraTarget.x;
      camera.target.z = cameraTarget.z;
      camera.target.y += (cameraTarget.y - camera.target.y) * (1 - Math.exp(-10 * dt));
      position.value = `X ${avatar.position.x.toFixed(1)} / Z ${avatar.position.z.toFixed(1)}`;
      position.dataset.y = avatar.position.y.toFixed(3);
      position.dataset.grounded = String(controller.grounded);
      document.querySelector('#motion-status')!.textContent = !controller.grounded ? (controller.velocity.y > 0 ? 'Jumping' : 'Falling') : controller.running ? 'Running' : moving ? 'Walking' : 'Standing';
      projectLabel(label, avatar.position);
      const localDisc = discs.get(identity.id);
      if (localDisc) projectLabel(localDisc, avatar.position.add(new Vector3(0, 0.5, 0)));
      const renderTime = performance.now() - 120;
      for (const remote of remotes.values()) {
        while (remote.samples.length > 2 && remote.samples[1].time <= renderTime) remote.samples.shift();
        const a = remote.samples[0];
        const b = remote.samples[1] ?? a;
        const t = a === b ? 1 : Math.max(0, Math.min(1, (renderTime - a.time) / (b.time - a.time)));
        remote.mesh.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
        remote.mesh.rotation.y = a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * t;
        remote.label.dataset.x = remote.mesh.position.x.toFixed(2);
        remote.label.dataset.z = remote.mesh.position.z.toFixed(2);
        remote.label.dataset.y = remote.mesh.position.y.toFixed(3);
        const animation = renderTime >= b.time ? b : a;
        remote.figure.update(dt, animation.moving, animation.running, animation.grounded);
        remote.label.dataset.animation = !animation.grounded ? 'jump' : animation.moving ? animation.running ? 'run' : 'walk' : 'idle';
        projectLabel(remote.label, remote.mesh.position);
        const disc = discs.get(animation.id);
        if (disc) projectLabel(disc, remote.mesh.position.add(new Vector3(0, 0.5, 0)));
      }
    }
  });
  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
  scene.executeWhenReady(() => {
    enter.disabled = false;
    enter.innerHTML = 'Enter lobby <span>↗</span>';
  });
}

try { start(); } catch (error) {
  const message = document.querySelector<HTMLElement>('#error')!;
  message.textContent = 'The 3D room could not start. Please use a browser with WebGL enabled and reload.';
  message.hidden = false;
  console.error(error);
}
