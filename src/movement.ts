import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Culling/ray';

// Metres and seconds. Fixed substeps keep gravity/collision stable across frame rates.
const STEP = 1 / 120;
export const WALK_SPEED = 3.5;
export const RUN_SPEED = 6.5;
const GRAVITY = 20;
const JUMP_SPEED = 7;

export class MovementController {
  readonly velocity = Vector3.Zero();
  grounded = false;
  running = false;
  private accumulator = 0;
  private jumpBuffer = 0;
  private coyote = 0;

  constructor(private readonly mesh: Mesh) {}

  jump() { this.jumpBuffer = 0.12; }

  stop() {
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.jumpBuffer = 0;
    this.running = false;
  }

  reset() {
    this.stop();
    this.velocity.y = 0;
    this.grounded = false;
    this.coyote = 0;
    this.accumulator = 0;
  }

  update(dt: number, direction: Vector3, sprint: boolean) {
    this.accumulator += Math.min(dt, 0.1);
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      this.step(direction, sprint);
    }
  }

  private support() {
    const ray = new Ray(this.mesh.position, Vector3.Down(), this.mesh.ellipsoid.y + 0.065);
    const hit = this.mesh.getScene().pickWithRay(ray, mesh => mesh !== this.mesh && mesh.checkCollisions && mesh.isEnabled());
    return Boolean(hit?.hit && (hit.getNormal(true)?.y ?? 0) > 0.65);
  }

  private step(direction: Vector3, sprint: boolean) {
    this.grounded = this.velocity.y <= 0 && this.support();
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - STEP);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - STEP);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
      this.jumpBuffer = 0;
      this.coyote = 0;
    }
    const hasInput = direction.lengthSquared() > 0;
    const speed = sprint ? RUN_SPEED : WALK_SPEED;
    const target = direction.scale(speed);
    // Brisk starts and stops on the floor; retain some momentum in the air.
    const acceleration = this.grounded ? (hasInput ? 30 : 42) : 10;
    const delta = new Vector3(target.x - this.velocity.x, 0, target.z - this.velocity.z);
    const change = Math.min(delta.length(), acceleration * STEP);
    if (change > 0) {
      delta.normalize().scaleInPlace(change);
      this.velocity.x += delta.x;
      this.velocity.z += delta.z;
    }
    this.running = sprint && Math.hypot(this.velocity.x, this.velocity.z) > WALK_SPEED + 0.2;
    this.mesh.moveWithCollisions(new Vector3(this.velocity.x * STEP, 0, this.velocity.z * STEP));
    this.velocity.y = this.grounded ? -2 : Math.max(-25, this.velocity.y - GRAVITY * STEP);
    const before = this.mesh.position.y;
    const vertical = this.velocity.y * STEP;
    this.mesh.moveWithCollisions(new Vector3(0, vertical, 0));
    const actual = this.mesh.position.y - before;
    if (this.velocity.y > 0 && actual < vertical - 0.001) this.velocity.y = 0;
    if (this.velocity.y < 0 && actual > vertical + 0.001 && this.support()) {
      this.velocity.y = 0;
      this.grounded = true;
    }
    this.mesh.position.x = Math.max(-9.45, Math.min(9.45, this.mesh.position.x));
    this.mesh.position.z = Math.max(-9.45, Math.min(9.45, this.mesh.position.z));
  }
}
