import Phaser from 'phaser';

/**
 * Phaser sends every picture to the graphics chip each frame, even the ones
 * far off screen: the town has about 260 pictures and labels, of which some
 * twenty are in view. This hides the rest from the main camera only (other
 * cameras and the objects' own visibility are untouched), checked each frame
 * with a circle around the view so it also works while the map turns.
 */

/** Extra room around the view (m), so nothing pops in at the edge. */
const MARGIN = 40;

type Placed = Phaser.GameObjects.Image | Phaser.GameObjects.Text;

export class OffscreenCull {
  private readonly items: Placed[];

  /** `objects`: things that never move (rotating in place is fine), such as the town's pictures and labels. */
  constructor(
    private readonly camera: Phaser.Cameras.Scene2D.Camera,
    objects: Phaser.GameObjects.GameObject[],
  ) {
    this.items = objects.filter(
      (o): o is Placed => o instanceof Phaser.GameObjects.Image || o instanceof Phaser.GameObjects.Text,
    );
  }

  update(): void {
    const cam = this.camera;
    const bit = cam.id;
    const { x: cx, y: cy } = cam.midPoint;
    const reach = Math.hypot(cam.width, cam.height) / 2 / cam.zoom + MARGIN;
    for (const o of this.items) {
      // The farthest corner from the object's anchor is at most its diagonal away, whatever its rotation.
      const r = reach + Math.hypot(o.displayWidth, o.displayHeight);
      const dx = o.x - cx;
      const dy = o.y - cy;
      const away = dx * dx + dy * dy > r * r;
      if (away) o.cameraFilter |= bit;
      else o.cameraFilter &= ~bit;
    }
  }
}
