import Phaser from 'phaser';
import { debugState } from './debugState';

/**
 * Always-running scene drawn above the game. Shows debug info when debug mode
 * is on and listens for the toggle keys. Later milestones add the route,
 * graph, hitbox and instruction views here.
 */
export class DebugOverlayScene extends Phaser.Scene {
  static readonly KEY = 'DebugOverlay';
  private panel?: Phaser.GameObjects.Text;

  constructor() {
    super(DebugOverlayScene.KEY);
  }

  create(): void {
    this.panel = this.add
      .text(8, 8, '', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '13px',
        color: '#e8f6ff',
        backgroundColor: 'rgba(10, 25, 32, 0.78)',
        padding: { x: 8, y: 6 },
      })
      .setDepth(1000)
      .setScrollFactor(0);

    const keyboard = this.input.keyboard;
    keyboard?.on('keydown-BACKTICK', () => debugState.toggle());
    keyboard?.on('keydown-F2', () => debugState.toggle());

    const unsubscribe = debugState.onChange(() => this.refresh());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    this.refresh();
  }

  override update(): void {
    if (debugState.isEnabled) this.refresh();
  }

  private refresh(): void {
    if (!this.panel) return;
    this.panel.setVisible(debugState.isEnabled);
    if (!debugState.isEnabled) return;

    const scenes = this.game.scene
      .getScenes(true)
      .map((scene) => scene.scene.key)
      .filter((key) => key !== DebugOverlayScene.KEY);
    const lines = [
      `DEBUG  v${__APP_VERSION__}  ${Math.round(this.game.loop.actualFps)} fps`,
      `scene: ${scenes.join(', ') || '-'}`,
      ...[...debugState.info].map(([key, value]) => `${key}: ${value}`),
      'toggle: ` or F2',
    ];
    this.panel.setText(lines.join('\n'));
  }
}
