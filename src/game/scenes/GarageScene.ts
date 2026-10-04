import Phaser from 'phaser';
import { jingles, menuMusic } from '../audio/Jingles';
import { COSMETIC_SLOTS, cosmeticsIn, liveryLook, SLOT_NAMES, type CosmeticSlot } from '../../engine/campaign/cosmetics';
import { rankFor, totalStars } from '../../engine/campaign/profile';
import { HUD_THEMES } from '../hud/Hud';
import { GAME_HEIGHT, GAME_WIDTH } from '../layout';
import { chooseLook, currentLook, isEarned } from '../lookStore';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';
import { loadProfile } from '../profileStore';
import { createOfficer, createPoliceCar } from '../render/actors';
import { arrestEffect, victoryPose } from '../render/celebrate';
import { DriftEffects } from '../render/drift';
import { backdrop, SCREEN_PICTURES } from '../ui/ui';

export interface GarageSceneData {
  /** Opened over another scene (the pause menu), which carries on when the garage closes. */
  overlayOf?: string;
  /** Called when the garage closes (the chase redraws its police). */
  onClose?: () => void;
  /** Otherwise, the screen to go back to. */
  back?: string;
}

/** Where the preview is built, far from the screen's own objects, and the camera that films it. */
const STAGE = { x: 6000, y: 6000 } as const;
const VIEW = { x: 330, y: 96, w: 450, h: 500 } as const;
/** Far from the town and the menu: what is drawn over the preview (the stamp, the HUD sample) lives here, filmed by a clear camera on top. */
const OVER = { x: -6000, y: -6000 } as const;

/**
 * The garage (Mr Henry, 2026-10-04): the player picks their police vehicle,
 * colours, officer's look, victory pose, tyre smoke, arrest effect and chase
 * screen. Locked items say how to earn them. The preview is the real thing at
 * town scale, filmed by a zoomed camera: the car turns on a turntable (and
 * drifts in circles to show off its smoke), the officer poses, the arrest
 * effect plays.
 *
 * Keys: ◀ ▶ change the slot, ▲ ▼ choose, ENTRÉE or ESPACE wears it, ÉCHAP leaves.
 */
export class GarageScene extends Phaser.Scene {
  static readonly KEY = 'Garage';
  private opts: GarageSceneData = {};
  private slot: CosmeticSlot = 'VEHICLE';
  private cursor = 0;
  private rows: Phaser.GameObjects.GameObject[] = [];
  private tabs: { box: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = [];
  private preview: Phaser.GameObjects.GameObject[] = [];
  private car: Phaser.GameObjects.Container | null = null;
  private officer: Phaser.GameObjects.Container | null = null;
  private drift: DriftEffects | null = null;
  private camera!: Phaser.Cameras.Scene2D.Camera;
  private angle = 0;
  private hudSample: Phaser.GameObjects.Graphics | null = null;
  private demoTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super(GarageScene.KEY);
  }

  init(data: GarageSceneData): void {
    this.opts = data ?? {};
    this.slot = 'VEHICLE';
    this.cursor = 0;
    this.rows = [];
    this.tabs = [];
    this.preview = [];
    this.car = null;
    this.officer = null;
    this.drift = null;
    this.hudSample = null;
    this.demoTimer = null;
  }

  create(): void {
    if (!this.opts.overlayOf) menuMusic.start();
    backdrop(this, SCREEN_PICTURES.briefing, 0.55);
    if (this.opts.overlayOf) this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05121a, 0.5);
    this.label(GAME_WIDTH / 2, 20, 'GARAGE', 40, PALETTE.cream).setOrigin(0.5, 0);
    const profile = loadProfile();
    const summary = `★ ${totalStars(profile)} étoiles   ·   ${profile.arrests} arrestations   ·   Grade : ${rankFor(profile.points).name}`;
    this.label(GAME_WIDTH / 2, 68, summary, 18, PALETTE.paleYellow).setOrigin(0.5, 0);

    // The turntable under the preview, and the camera that films it.
    this.panel(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    this.camera = this.cameras.add(VIEW.x + 4, VIEW.y + 4, VIEW.w - 8, VIEW.h - 8).setZoom(7).centerOn(STAGE.x, STAGE.y);
    this.cameras.add(VIEW.x, VIEW.y, VIEW.w, VIEW.h).setScroll(OVER.x, OVER.y);
    this.camera.setBackgroundColor(0x8c8580);
    const floor = this.add.graphics();
    floor.fillStyle(0x7d7671).fillRect(STAGE.x - 60, STAGE.y - 60, 120, 120);
    floor.lineStyle(0.6, 0xf6ecd2, 0.5).strokeCircle(STAGE.x, STAGE.y, 15);
    floor.fillStyle(0x6f6964).fillCircle(STAGE.x, STAGE.y, 14.5);
    // Everything on the main camera stays off the preview camera (it is far away anyway).
    this.camera.ignore(this.children.list.filter((o) => o !== floor));

    // Slots down the left.
    COSMETIC_SLOTS.forEach((slot, i) => {
      const y = 126 + i * 62;
      const box = this.add.rectangle(170, y, 260, 50, PALETTE.cream).setStrokeStyle(3, PALETTE.ink).setInteractive({ useHandCursor: true });
      const label = this.label(170, y, SLOT_NAMES[slot].toUpperCase(), 20, PALETTE.ink).setOrigin(0.5);
      box.on('pointerdown', () => this.showSlot(slot));
      this.tabs.push({ box, label });
      this.camera.ignore([box, label]);
    });

    const back = this.add.rectangle(GAME_WIDTH / 2, 660, 260, 50, PALETTE.terracotta).setStrokeStyle(3, PALETTE.cream).setInteractive({ useHandCursor: true });
    const backLabel = this.label(GAME_WIDTH / 2, 660, 'RETOUR (ÉCHAP)', 20, PALETTE.cream).setOrigin(0.5);
    back.on('pointerdown', () => this.close());
    this.camera.ignore([back, backLabel]);
    const hint = this.label(GAME_WIDTH / 2, 616, '◀ ▶ : catégorie   ·   ▲ ▼ : choisir   ·   ENTRÉE : équiper', 16, PALETTE.cream).setOrigin(0.5);
    this.camera.ignore(hint);

    const keyboard = this.input.keyboard;
    keyboard?.on('keydown-ESC', () => this.close());
    keyboard?.on('keydown-LEFT', () => this.stepSlot(-1));
    keyboard?.on('keydown-RIGHT', () => this.stepSlot(1));
    keyboard?.on('keydown-UP', () => this.moveCursor(-1));
    keyboard?.on('keydown-DOWN', () => this.moveCursor(1));
    keyboard?.on('keydown-ENTER', () => this.wear());
    keyboard?.on('keydown-SPACE', () => this.wear());

    this.showSlot('VEHICLE');
  }

  override update(_time: number, delta: number): void {
    if (!this.car) return;
    const dt = delta / 1000;
    if (this.slot === 'SMOKE') {
      // Drifting round the turntable, sideways, laying its smoke and marks.
      this.angle += dt * 1.6;
      const r = 9;
      const x = STAGE.x + Math.cos(this.angle) * r;
      const y = STAGE.y + Math.sin(this.angle) * r;
      const heading = this.angle + Math.PI / 2 + 0.5;
      this.car.setPosition(x, y).setRotation(heading);
      this.drift?.tyres('demo', x, y, heading, 1, dt);
      this.drift?.update({ x, y, heading, speed: 0, driving: false }, heading, delta);
    } else {
      this.angle += dt * 0.6;
      this.car.setPosition(STAGE.x, STAGE.y).setRotation(this.angle);
    }
  }

  private showSlot(slot: CosmeticSlot): void {
    if (slot !== this.slot) jingles.move();
    this.slot = slot;
    const items = cosmeticsIn(slot);
    const worn = currentLook()[slot];
    this.cursor = Math.max(0, items.findIndex((c) => c.id === worn));
    COSMETIC_SLOTS.forEach((s, i) => {
      const on = s === slot;
      this.tabs[i]!.box.setFillStyle(on ? PALETTE.terracotta : PALETTE.cream);
      this.tabs[i]!.label.setColor(toCss(on ? PALETTE.cream : PALETTE.ink));
    });
    this.drawList();
    this.buildPreview();
  }

  private stepSlot(by: number): void {
    const i = COSMETIC_SLOTS.indexOf(this.slot);
    this.showSlot(COSMETIC_SLOTS[(i + by + COSMETIC_SLOTS.length) % COSMETIC_SLOTS.length]!);
  }

  private moveCursor(by: number): void {
    const n = cosmeticsIn(this.slot).length;
    this.cursor = (this.cursor + by + n) % n;
    jingles.move();
    this.drawList();
  }

  /** Wear the item under the cursor, if it has been earned. */
  private wear(index = this.cursor): void {
    const item = cosmeticsIn(this.slot)[index];
    if (!item) return;
    this.cursor = index;
    if (!isEarned(this.slot, item.id)) {
      jingles.move();
      this.drawList();
      return;
    }
    jingles.select();
    chooseLook(this.slot, item.id);
    this.drawList();
    this.buildPreview();
  }

  /** The items in this slot, down the right: worn ✓, earned, or 🔒 with how to earn it. */
  private drawList(): void {
    this.rows.forEach((o) => o.destroy());
    this.rows = [];
    const items = cosmeticsIn(this.slot);
    const worn = currentLook()[this.slot];
    const x = 800;
    const w = 440;
    const rowH = Math.min(62, Math.floor(500 / items.length));
    const top = VIEW.y;
    const big = rowH >= 48;
    items.forEach((item, i) => {
      const y = top + i * rowH;
      const earned = isEarned(this.slot, item.id);
      const here = i === this.cursor;
      const box = this.add
        .rectangle(x, y, w, rowH - 6, here ? PALETTE.paleYellow : PALETTE.cream, earned ? 0.96 : 0.7)
        .setOrigin(0)
        .setStrokeStyle(here ? 3 : 2, here ? PALETTE.terracotta : PALETTE.ink)
        .setInteractive({ useHandCursor: true });
      box.on('pointerover', () => {
        if (this.cursor !== i) {
          this.cursor = i;
          this.drawList();
        }
      });
      box.on('pointerdown', () => this.wear(i));
      const mark = item.id === worn ? '✓' : earned ? '' : '🔒';
      const name = this.label(x + 14, y + (big ? 8 : (rowH - 6) / 2), `${mark ? `${mark}  ` : ''}${item.name}`, big ? 19 : 16, PALETTE.ink);
      if (!big) name.setOrigin(0, 0.5);
      const parts: Phaser.GameObjects.GameObject[] = [box, name];
      if (big) {
        const how = item.id === worn ? 'Équipé' : earned ? 'Débloqué : ENTRÉE pour équiper' : `À gagner : ${item.unlock}`;
        parts.push(this.label(x + 14, y + 32, how, 14, earned ? PALETTE.seaDeep : PALETTE.terracotta));
      } else if (!earned) {
        parts.push(this.label(x + w - 12, y + (rowH - 6) / 2, item.unlock, 13, PALETTE.terracotta).setOrigin(1, 0.5));
      }
      this.camera.ignore(parts);
      this.rows.push(...parts);
    });
  }

  /** The preview: the car on its turntable, the officer beside it, and the slot's demo. */
  private buildPreview(): void {
    this.demoTimer?.remove();
    this.preview.forEach((o) => o.destroy());
    this.preview = [];
    this.hudSample?.destroy();
    this.hudSample = null;
    const look = currentLook();
    const colours = liveryLook(look.LIVERY);
    const keep = (o: Phaser.GameObjects.GameObject) => {
      this.cameras.main.ignore(o);
      this.preview.push(o);
    };
    this.drift = new DriftEffects(this, { ids: ['demo'], style: look.SMOKE });
    this.drift.objects.forEach(keep);
    this.car = createPoliceCar(this, colours, look.VEHICLE).setPosition(STAGE.x, STAGE.y);
    keep(this.car);
    const officerAt = { x: STAGE.x, y: STAGE.y + 19 };
    this.officer = createOfficer(this, colours, look.OUTFIT).setPosition(officerAt.x, officerAt.y).setRotation(-Math.PI / 2);
    keep(this.officer);

    const person = this.slot === 'OUTFIT' || this.slot === 'POSE';
    // The HUD sample sits along the bottom of the preview, so the car moves up out of its way.
    this.camera.pan(person ? officerAt.x : STAGE.x, person ? officerAt.y : STAGE.y + (this.slot === 'HUD' ? 22 : 6), 300, 'Sine.easeInOut');
    this.camera.zoomTo(person ? 22 : this.slot === 'SMOKE' ? 7 : 9, 300);

    if (this.slot === 'POSE') {
      const pose = () => this.officer && victoryPose(this, this.officer, look.POSE);
      pose();
      this.demoTimer = this.time.addEvent({ delay: 2200, loop: true, callback: pose });
    }
    if (this.slot === 'ARREST') {
      const play = () =>
        arrestEffect(this, look.ARREST, { x: STAGE.x + 10, y: STAGE.y + 4 }, (o) => this.screenOnly(o), (o) => keep(o), 0.5);
      play();
      this.demoTimer = this.time.addEvent({ delay: 2800, loop: true, callback: play });
    }
    if (this.slot === 'HUD') this.drawHudSample(look.HUD);
  }

  /** A stamp made by the arrest effect belongs on the screen over the preview, not in the town. */
  private screenOnly(o: Phaser.GameObjects.GameObject): void {
    const shown = o as unknown as Phaser.GameObjects.Components.Transform;
    shown.setPosition?.(OVER.x + VIEW.w / 2, OVER.y + 90);
    this.preview.push(o);
  }

  /** A corner of the chase screen in the chosen theme: a radar panel. */
  private drawHudSample(id: string): void {
    const t = HUD_THEMES[id] ?? HUD_THEMES.TABLETTE!;
    const g = this.add.graphics();
    const x = OVER.x + 75;
    const y = OVER.y + VIEW.h - 130;
    g.fillStyle(t.fill, 0.9).fillRoundedRect(x, y, 300, 100, 10);
    g.lineStyle(2, t.edge, 0.7).strokeRoundedRect(x, y, 300, 100, 10);
    g.fillStyle(t.radarBack).fillCircle(x + 52, y + 50, 36);
    g.lineStyle(2, t.radar, 0.9).strokeCircle(x + 52, y + 50, 36).lineBetween(x + 52, y + 50, x + 80, y + 28);
    g.lineStyle(1, t.radar, 0.4).strokeCircle(x + 52, y + 50, 22);
    for (let i = 0; i < 5; i++) g.fillStyle(i < 4 ? 0x6fcf7c : 0x55656b).fillRect(x + 110 + i * 18, y + 72 - (10 + i * 6), 12, 10 + i * 6);
    const label = this.label(x + 110, y + 14, 'SIGNAL', 15, t.label);
    this.hudSample = g;
    this.preview.push(label);
  }

  private close(): void {
    jingles.select();
    this.opts.onClose?.();
    if (this.opts.overlayOf) {
      this.scene.stop();
      this.scene.resume(this.opts.overlayOf);
    } else {
      this.scene.start(this.opts.back ?? 'Title');
    }
  }

  private panel(x: number, y: number, w: number, h: number): void {
    this.add.rectangle(x + 6, y + 8, w, h, 0x000000, 0.35).setOrigin(0);
    this.add.rectangle(x, y, w, h, 0x10232d, 0.97).setOrigin(0).setStrokeStyle(3, PALETTE.lightBlue, 0.6);
  }

  private label(x: number, y: number, value: string, size: number, colour: number): Phaser.GameObjects.Text {
    return this.add.text(x, y, value, { fontFamily: FONT_FAMILY, fontSize: `${size}px`, fontStyle: 'bold', color: toCss(colour) });
  }
}

/** Open the garage over `scene` (the pause menu), which waits until it closes. */
export function openGarage(scene: Phaser.Scene, onClose?: () => void): void {
  scene.scene.launch(GarageScene.KEY, { overlayOf: scene.scene.key, ...(onClose ? { onClose } : {}) } satisfies GarageSceneData);
  scene.scene.pause();
}
