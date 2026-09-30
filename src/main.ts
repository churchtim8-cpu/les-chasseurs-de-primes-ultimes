import Phaser from 'phaser';
import { DebugOverlayScene } from './game/debug/DebugOverlayScene';
import { debugState } from './game/debug/debugState';
import { GAME_HEIGHT, GAME_WIDTH, TitleScene } from './game/scenes/TitleScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#16323d',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [TitleScene, DebugOverlayScene],
});

// The overlay runs on top of every other scene.
game.events.once(Phaser.Core.Events.READY, () => {
  game.scene.start(DebugOverlayScene.KEY);
  game.scene.bringToTop(DebugOverlayScene.KEY);
});

// Small hook for browser tests and for poking at the game from the console.
declare global {
  interface Window {
    __bellevue?: { game: Phaser.Game; debug: typeof debugState };
  }
}
window.__bellevue = { game, debug: debugState };
