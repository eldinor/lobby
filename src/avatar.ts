import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Material } from '@babylonjs/core/Materials/material';

export function createAvatar(body: Mesh, shirt: Material, detail: Material) {
  const scene = body.getScene();
  body.isVisible = false;
  const root = new TransformNode(`${body.name}-figure`, scene);
  root.parent = body;
  root.position.y = -0.8;
  function part(name: string, width: number, height: number, depth: number, x: number, y: number, z: number, parent: TransformNode = root, mat = shirt) {
    const mesh = CreateBox(`${body.name}-${name}`, { width, height, depth }, scene);
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.material = mat;
    mesh.isPickable = false;
    return mesh;
  }
  part('torso', 0.48, 0.5, 0.28, 0, 1.03, 0);
  const head = CreateSphere(`${body.name}-head`, { diameter: 0.38, segments: 8 }, scene);
  head.parent = root;
  head.position.y = 1.5;
  head.material = shirt;
  head.isPickable = false;
  part('visor', 0.28, 0.1, 0.06, 0, 1.52, 0.17, root, detail);
  function limb(name: string, x: number, y: number, length: number, width: number) {
    const pivot = new TransformNode(`${body.name}-${name}-joint`, scene);
    pivot.parent = root;
    pivot.position.set(x, y, 0);
    part(name, width, length, width, 0, -length / 2, 0, pivot, name.includes('leg') ? detail : shirt);
    return pivot;
  }
  const leftArm = limb('left-arm', -0.33, 1.24, 0.5, 0.16);
  const rightArm = limb('right-arm', 0.33, 1.24, 0.5, 0.16);
  const leftLeg = limb('left-leg', -0.14, 0.77, 0.7, 0.19);
  const rightLeg = limb('right-leg', 0.14, 0.77, 0.7, 0.19);
  let phase = Math.random() * Math.PI * 2;
  let blend = 0;
  return {
    update(dt: number, moving: boolean, running: boolean, grounded: boolean) {
      blend += ((moving ? 1 : 0) - blend) * (1 - Math.exp(-12 * dt));
      phase += dt * (running ? 15 : moving ? 10 : 2);
      const stride = Math.sin(phase) * blend * (running ? 0.95 : 0.55);
      const smooth = 1 - Math.exp(-18 * dt);
      const aim = (node: TransformNode, x: number, z = 0) => {
        node.rotation.x += (x - node.rotation.x) * smooth;
        node.rotation.z += (z - node.rotation.z) * smooth;
      };
      aim(leftLeg, grounded ? stride : -0.45);
      aim(rightLeg, grounded ? -stride : 0.6);
      aim(leftArm, grounded ? -stride * 0.85 : -1, grounded ? -0.06 : -0.35);
      aim(rightArm, grounded ? stride * 0.85 : -1, grounded ? 0.06 : 0.35);
      root.rotation.x += ((grounded && running ? 0.1 : 0) - root.rotation.x) * smooth;
      root.position.y = -0.8 + (grounded ? Math.abs(Math.sin(phase)) * blend * 0.035 + Math.sin(phase) * (1 - blend) * 0.008 : 0);
    },
  };
}
