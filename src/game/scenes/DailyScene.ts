import Phaser from 'phaser';
import { menuMusic } from '../audio/Jingles';
import { DIFFICULTY_SETTINGS } from '../../engine';
import { addEntry, boardFor, cleanName, DAILY, dailyChase, hasPlayed, mergeBoard, readScoreCode, type DailyEntry } from '../../engine/campaign/daily';
import { loadBoard, saveBoard } from '../dailyStore';
import { debugState } from '../debug/debugState';
import { PALETTE, toCss } from '../palette';
import { fetchBoard, flushScores, onlineOn, removeScore } from '../online/onlineBoard';
import { today } from '../profileStore';
import { WEATHER_ICONS, WEATHER_NAMES } from '../render/weather';
import { askText } from '../ui/textForm';
import { backdrop, Menu, paper, SCREEN_PICTURES, text } from '../ui/ui';

/** The day written out for the screen, e.g. "Sunday 4 October 2026". */
function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Le défi du jour (Mr Henry, 2026-10-04): today's chase, the same for every
 * student, and the class board for the class code typed on this device. The
 * first try counts; a finished first try gives a score code, and the teacher
 * can type students' codes in here (ADD SCORE CODE) to gather the whole class
 * on one device. With the online board switched on, the board also shows the
 * whole class from the server, and the teacher can remove a name with a PIN.
 */
export class DailyScene extends Phaser.Scene {
  static readonly KEY = 'Daily';
  private boardLayer?: Phaser.GameObjects.Container;

  constructor() {
    super(DailyScene.KEY);
  }

  create(): void {
    menuMusic.start();
    const { width } = this.scale;
    const date = today();
    const chase = dailyChase(date);
    const board = loadBoard();
    const played = hasPlayed(board, date);
    debugState.info.set('daily', chase.seed.code);

    backdrop(this, SCREEN_PICTURES.briefing, 0.5);
    text(this, width / 2, 20, 'DAILY CHALLENGE', 38, { bold: true, color: toCss(PALETTE.cream) }).setOrigin(0.5, 0);
    text(this, width / 2, 66, 'Le défi du jour: one chase for everybody, a new one every day', 19, { color: toCss(PALETTE.paleYellow) }).setOrigin(0.5, 0);

    // Today's chase and who is playing.
    paper(this, 40, 104, 560, 500);
    text(this, 66, 122, longDate(date), 26, { bold: true });
    text(this, 66, 162, `Level: ${DIFFICULTY_SETTINGS[chase.difficulty].label.en}   ·   ${WEATHER_ICONS[chase.weather]} ${WEATHER_NAMES[chase.weather]}`, 22, { color: toCss(PALETTE.seaDeep), bold: true });
    text(this, 66, 194, `Chase ${chase.seed.code}`, 17, { color: toCss(PALETTE.seaDeep) });
    this.add.rectangle(66, 232, 508, 2, PALETTE.ink, 0.4).setOrigin(0);
    text(this, 66, 248, 'Nickname', 17, { color: toCss(PALETTE.seaDeep) });
    text(this, 66, 270, board.nickname || '—', 28, { bold: true });
    text(this, 380, 248, 'Class code', 17, { color: toCss(PALETTE.seaDeep) });
    text(this, 380, 270, board.classCode || '—', 28, { bold: true });
    const mine = board.entries.find((e) => e.date === date && e.local && e.nickname === board.nickname && e.classCode === board.classCode);
    const status = !played
      ? 'Only your FIRST try counts for the class board, so listen carefully!'
      : mine
        ? `Today's score: ${mine.score}  ${'★'.repeat(mine.stars)}${'☆'.repeat(3 - mine.stars)}\nYou can play again for practice; the board keeps your first try.`
        : 'You have used your try today. You can play again for practice.';
    text(this, 66, 330, status, 20, { wordWrap: { width: 508 }, lineSpacing: 6 });
    text(this, 66, 444, 'Tomorrow brings a new chase.\nMon Easy · Tue Intermediate · Wed Hard · Thu Intermediate\nFri Expert · Sat Easy · Sun Hard', 16, { color: toCss(PALETTE.seaDeep), lineSpacing: 4 });

    // The class board: this device's at once, then the online one when it arrives.
    paper(this, 640, 104, 600, 500);
    const online = onlineOn() && board.classCode !== '';
    this.drawBoard(date, board.classCode, null, online ? 'loading' : 'device');
    if (online) void this.loadOnline(date, board.classCode);

    const menu = new Menu(this);
    menu.add(320, 552, 300, 58, played ? 'PRACTICE AGAIN  ▶' : 'PLAY  ▶', () => void this.play(date), { size: 24 });
    if (onlineOn()) {
      menu.add(width / 2 - 465, 668, 290, 50, '✏️ NAME & CLASS (N)', () => void this.editNames(), { key: 'N', size: 18 });
      menu.add(width / 2 - 155, 668, 290, 50, '➕ ADD SCORE CODE (A)', () => void this.addCode(date), { key: 'A', size: 18 });
      menu.add(width / 2 + 155, 668, 290, 50, '🗑️ REMOVE A NAME (X)', () => void this.removeName(date), { key: 'X', size: 18 });
      menu.add(width / 2 + 465, 668, 290, 50, 'BACK', () => this.scene.start('Title'), { key: 'ESC', size: 20 });
      if (board.classCode) menu.add(1176, 128, 108, 36, '⟳ (R)', () => void this.loadOnline(date, board.classCode), { key: 'R', size: 16 });
    } else {
      menu.add(width / 2 - 330, 668, 300, 50, '✏️ NAME & CLASS (N)', () => void this.editNames(), { key: 'N', size: 19 });
      menu.add(width / 2, 668, 300, 50, '➕ ADD SCORE CODE (A)', () => void this.addCode(date), { key: 'A', size: 19 });
      menu.add(width / 2 + 330, 668, 300, 50, 'BACK', () => this.scene.start('Title'), { key: 'ESC', size: 20 });
    }
  }

  /** Sends any first tries still waiting, then shows the whole class from the server. */
  private async loadOnline(date: string, classCode: string): Promise<void> {
    this.drawBoard(date, classCode, null, 'loading');
    await flushScores();
    const rows = await fetchBoard(date, classCode);
    if (!this.scene.isActive()) return;
    debugState.info.set('dailyOnline', rows ? String(rows.length) : 'offline');
    this.drawBoard(date, classCode, rows, rows ? 'online' : 'offline');
  }

  /**
   * The class board. `source` says where it comes from: this device only, the
   * online board (still loading, reached, or out of reach).
   */
  private drawBoard(date: string, classCode: string, online: DailyEntry[] | null, source: 'device' | 'loading' | 'online' | 'offline'): void {
    this.boardLayer?.destroy();
    const layer = this.add.container(0, 0);
    this.boardLayer = layer;
    const x = 640;
    if (!classCode) {
      layer.add(text(this, x + 300, 300, 'Type your class code\n(✏️ NAME & CLASS) to see\nyour class board.', 24, { align: 'center', lineSpacing: 8 }).setOrigin(0.5));
      return;
    }
    layer.add(text(this, x + 26, 122, `CLASS ${classCode}  ·  TODAY`, 26, { bold: true }));
    const note = {
      device: 'Scores played or added on this device',
      loading: '🌐 Getting the online board…',
      online: '🌐 Online board: the whole class',
      offline: 'Online board out of reach: this device only. Score codes still work.',
    }[source];
    layer.add(text(this, x + 26, 576, note, 15, { color: toCss(source === 'offline' ? PALETTE.terracotta : PALETTE.seaDeep) }));
    const device = boardFor(loadBoard(), date, classCode);
    const list = online ? mergeBoard(device, online) : device;
    if (list.length === 0) {
      layer.add(text(this, x + 300, 330, source === 'loading' ? '…' : 'No scores yet today.\nBe the first!', 24, { align: 'center', lineSpacing: 8 }).setOrigin(0.5));
      return;
    }
    // Two columns of up to 15 names.
    list.slice(0, DAILY.boardSize).forEach((e, i) => {
      const col = Math.floor(i / 15);
      const row = i % 15;
      const cx = x + 26 + col * 290;
      const cy = 166 + row * 28;
      const medal = i === 0 ? 0xd4a017 : i === 1 ? 0x9aa5ad : i === 2 ? 0xb06a3b : PALETTE.ink;
      const me = e.nickname === loadBoard().nickname;
      if (me) layer.add(this.add.rectangle(cx - 6, cy - 3, 284, 26, PALETTE.paleYellow).setOrigin(0));
      layer.add([
        text(this, cx + 34, cy, e.nickname, 18, { bold: i < 3 || me, color: toCss(me ? PALETTE.terracotta : PALETTE.ink) }),
        text(this, cx, cy, `${i + 1}.`, 18, { bold: true, color: toCss(medal) }),
        text(this, cx + 170, cy, '★'.repeat(e.stars) + '☆'.repeat(3 - e.stars), 15, { color: toCss(0x9c7a12) }),
        text(this, cx + 270, cy, String(e.score), 18, { bold: true }).setOrigin(1, 0),
      ]);
    });
  }

  private async play(date: string): Promise<void> {
    const board = loadBoard();
    if (!board.nickname || !board.classCode) {
      const ok = await this.editNames(false);
      if (!ok) return;
    }
    const chase = dailyChase(date);
    debugState.info.set('seed', chase.seed.code);
    this.scene.start('Chase', { seed: chase.seed.code, daily: date });
  }

  /** Nickname and class code for this device. Resolves true once both are set. */
  private async editNames(restart = true): Promise<boolean> {
    const board = loadBoard();
    const values = await askText(
      this,
      'Your nickname and class',
      [
        { label: 'Nickname (no real names)', value: board.nickname, max: DAILY.maxNickname, placeholder: 'e.g. TI JEAN' },
        { label: 'Class code (from your teacher)', value: board.classCode, max: DAILY.maxClassCode, placeholder: 'e.g. 4B' },
      ],
      'Your class board shows everyone who plays on this device with the same class code.',
    );
    if (!values || !this.scene.isActive()) return false;
    const nickname = cleanName(values[0] ?? '', DAILY.maxNickname);
    const classCode = cleanName(values[1] ?? '', DAILY.maxClassCode);
    saveBoard({ ...loadBoard(), nickname, classCode });
    if (restart || !nickname || !classCode) this.scene.restart();
    return nickname !== '' && classCode !== '';
  }

  /** For the teacher: a student's score code goes on this device's board. */
  private async addCode(date: string): Promise<void> {
    const board = loadBoard();
    const values = await askText(
      this,
      "Add a student's score code",
      [
        { label: "Student's nickname", max: DAILY.maxNickname },
        { label: 'Class code', value: board.classCode, max: DAILY.maxClassCode },
        { label: 'Score code (from their results screen)', max: 9, placeholder: 'e.g. 7K3-Q2P' },
      ],
      "Codes only work for today's chase and for the nickname and class they were earned with.",
    );
    if (!values || !this.scene.isActive()) return;
    const [nickname = '', classCode = '', code = ''] = values;
    const result = readScoreCode(code, date, nickname, classCode);
    if (!result || !cleanName(nickname, DAILY.maxNickname) || !cleanName(classCode, DAILY.maxClassCode)) {
      this.scene.restart();
      this.events.once(Phaser.Scenes.Events.CREATE, () => this.toast('That code does not match this nickname, class and day.', PALETTE.terracotta));
      return;
    }
    saveBoard(addEntry(loadBoard(), { date, nickname, classCode, ...result, local: false }));
    if (!loadBoard().classCode) saveBoard({ ...loadBoard(), classCode: cleanName(classCode, DAILY.maxClassCode) });
    this.scene.restart();
    this.events.once(Phaser.Scenes.Events.CREATE, () => this.toast(`Added ${cleanName(nickname, DAILY.maxNickname)}: ${result.score} points.`, 0x2e8b57));
  }

  /** For the teacher: takes a silly or fake name off today's online class board (needs the teacher PIN). */
  private async removeName(date: string): Promise<void> {
    const values = await askText(
      this,
      'Remove a name from the online board',
      [
        { label: 'Nickname to remove', max: DAILY.maxNickname },
        { label: 'Class code', value: loadBoard().classCode, max: DAILY.maxClassCode },
        { label: 'Teacher PIN', max: 20 },
      ],
      "For the teacher only. It removes that name from today's board for everyone.",
    );
    if (!values || !this.scene.isActive()) return;
    const nickname = cleanName(values[0] ?? '', DAILY.maxNickname);
    const classCode = cleanName(values[1] ?? '', DAILY.maxClassCode);
    const result = nickname && classCode ? await removeScore(date, classCode, nickname, (values[2] ?? '').trim()) : 'wrong';
    if (!this.scene.isActive()) return;
    // The device's own copy goes too, so the name does not come straight back.
    if (result === 'removed') {
      const board = loadBoard();
      saveBoard({ ...board, entries: board.entries.filter((e) => !(e.date === date && e.classCode === classCode && e.nickname === nickname)) });
    }
    this.scene.restart();
    const message = {
      removed: [`Removed ${nickname} from class ${classCode}.`, 0x2e8b57],
      wrong: ['Nothing removed: check the nickname, class and PIN.', PALETTE.terracotta],
      offline: ['The online board is out of reach. Try again later.', PALETTE.terracotta],
    }[result] as [string, number];
    this.events.once(Phaser.Scenes.Events.CREATE, () => this.toast(message[0], message[1]));
  }

  private toast(message: string, colour: number): void {
    const t = text(this, this.scale.width / 2, 620, message, 20, { bold: true, color: toCss(PALETTE.cream), backgroundColor: toCss(colour), padding: { x: 14, y: 6 } }).setOrigin(0.5);
    this.tweens.add({ targets: t, alpha: 0, delay: 3200, duration: 600 });
  }
}
