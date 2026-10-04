import Phaser from 'phaser';
import { scannerAudio } from './game/audio/ScannerAudio';
import { DebugOverlayScene } from './game/debug/DebugOverlayScene';
import { FullscreenScene } from './game/scenes/FullscreenScene';
import { debugState } from './game/debug/debugState';
import { GAME_HEIGHT, GAME_WIDTH } from './game/layout';
import { BootScene } from './game/scenes/BootScene';
import { BriefingScene } from './game/scenes/BriefingScene';
import { CampaignScene } from './game/scenes/CampaignScene';
import { CaseClosedScene } from './game/scenes/CaseClosedScene';
import { CommissariatScene } from './game/scenes/CommissariatScene';
import { ChaseScene } from './game/scenes/ChaseScene';
import { EscapeScene } from './game/scenes/EscapeScene';
import { PracticeScene } from './game/scenes/PracticeScene';
import { PauseScene } from './game/scenes/PauseScene';
import { CommandsScene } from './game/scenes/CommandsScene';
import { ResultsScene } from './game/scenes/ResultsScene';
import { TitleScene } from './game/scenes/TitleScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#16323d',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // Phaser holds game time to 60 fps for `panicMax` frames after a start or tab switch;
  // the default (120 frames) makes the chase crawl for seconds on slow school computers.
  fps: { panicMax: 20 },
  // Every sound is made by our own Web Audio mixer (ScannerAudio); Phaser's
  // sound system would only run a second, silent audio engine alongside it.
  audio: { noAudio: true },
  // Boot (the loading screen) runs first, then the title screen.
  scene: [BootScene, TitleScene, CampaignScene, BriefingScene, PracticeScene, ChaseScene, EscapeScene, ResultsScene, CaseClosedScene, CommissariatScene, PauseScene, CommandsScene, FullscreenScene, DebugOverlayScene],
});

// The overlay runs on top of every other scene.
game.events.once(Phaser.Core.Events.READY, () => {
  game.scene.start(FullscreenScene.KEY);
  game.scene.start(DebugOverlayScene.KEY);
  game.scene.bringToTop(FullscreenScene.KEY);
  game.scene.bringToTop(DebugOverlayScene.KEY);
});

// Small hook for browser tests and for poking at the game from the console.
declare global {
  interface Window {
    __bellevue?: { game: Phaser.Game; debug: typeof debugState; audio: typeof scannerAudio };
  }
}
window.__bellevue = { game, debug: debugState, audio: scannerAudio };
