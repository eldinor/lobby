import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { ChatMessage } from './multiplayer';

export function createChatScreen(scene: Scene) {
  const canvas = document.createElement('canvas');
  canvas.id = 'room-chat-texture';
  canvas.width = 1536;
  canvas.height = 648;
  const texture = new DynamicTexture('room chat', canvas, scene, true);
  const context = canvas.getContext('2d')!;
  const material = new StandardMaterial('chat screen', scene);
  material.disableLighting = true;
  material.diffuseColor = Color3.Black();
  // StandardMaterial adds emissiveColor to emissiveTexture; white washes out the screen.
  material.emissiveColor = Color3.Black();
  material.emissiveTexture = texture;
  const surface = CreatePlane('chat screen surface', { width: 6.16, height: 2.6 }, scene);
  surface.position.set(1, 1.65, -9.68);
  surface.rotation.y = Math.PI;
  surface.material = material;
  surface.isPickable = false;
  const messages: ChatMessage[] = [];

  function lines(text: string, width: number, maxLines: number) {
    const result: string[] = [];
    let line = '';
    // Break at whitespace where possible, and split long unbroken strings safely.
    for (const word of text.split(/\s+/u)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= width) { line = candidate; continue; }
      if (line) { result.push(line); line = ''; }
      for (const character of word) {
        if (line && context.measureText(line + character).width > width) { result.push(line); line = ''; }
        line += character;
      }
    }
    if (line) result.push(line);
    if (result.length > maxLines) {
      result.length = maxLines;
      let last = result[maxLines - 1];
      while (last && context.measureText(`${last}…`).width > width) last = Array.from(last).slice(0, -1).join('');
      result[maxLines - 1] = `${last}…`;
    }
    return result;
  }

  function draw() {
    context.fillStyle = '#14291f';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.textBaseline = 'top';
    context.fillStyle = '#9cc8a7';
    context.font = 'bold 22px Arial, sans-serif';
    context.fillText('LOBBY / ROOM CHAT', 44, 24);
    context.fillStyle = '#36523f';
    context.fillRect(44, 63, 1448, 2);
    if (!messages.length) {
      context.fillStyle = '#edf3e7';
      context.font = '36px Arial, sans-serif';
      context.fillText('A little conversation starts here.', 44, 242);
      context.fillStyle = '#a8bda6';
      context.font = '24px Arial, sans-serif';
      context.fillText('Press Enter to chat with everyone in the room.', 44, 300);
    }
    let y = 84;
    for (const message of messages) {
      context.fillStyle = '#a8d8b0';
      context.font = 'bold 20px Arial, sans-serif';
      context.fillText(message.name, 44, y, 1448);
      context.fillStyle = '#edf3e7';
      context.font = '24px Arial, sans-serif';
      const wrapped = lines(message.text, 1448, 2);
      for (let i = 0; i < wrapped.length; i++) context.fillText(wrapped[i], 44, y + 25 + i * 28);
      y += 86;
    }
    context.fillStyle = '#849e85';
    context.font = '18px Arial, sans-serif';
    context.fillText('LATEST MESSAGES THIS VISIT  /  OPEN CHAT FOR THE FULL CONVERSATION', 44, 614);
    texture.update();
  }
  draw();
  scene.onDisposeObservable.add(() => { texture.dispose(); material.dispose(); });
  return {
    receive(message: ChatMessage) {
      messages.push(message);
      if (messages.length > 6) messages.shift();
      draw();
    },
    clear() { messages.length = 0; draw(); },
  };
}
