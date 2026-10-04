import Phaser from 'phaser';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';

export interface FormField {
  label: string;
  value?: string;
  max: number;
  placeholder?: string;
}

/**
 * A small typing card over the game (nicknames, class codes, score codes).
 * It uses real page text boxes so phones and tablets bring up their own
 * keyboard. The scene's keys are switched off while it is open, so typing
 * "E" or SPACE does not press a menu button. Resolves with the typed values,
 * or null when cancelled (ESC or CANCEL).
 */
export function askText(scene: Phaser.Scene, title: string, fields: FormField[], note = ''): Promise<string[] | null> {
  const keyboard = scene.input.keyboard;
  if (keyboard) {
    keyboard.enabled = false;
    keyboard.disableGlobalCapture();
  }
  const host = document.fullscreenElement ?? document.body;
  const shade = document.createElement('div');
  shade.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(11,26,32,0.6);';
  const card = document.createElement('form');
  card.style.cssText = `font-family:${FONT_FAMILY};background:${toCss(PALETTE.cream)};color:${toCss(PALETTE.ink)};border:3px solid ${toCss(PALETTE.ink)};border-radius:10px;padding:20px 24px;width:min(420px,86vw);box-shadow:0 8px 0 rgba(0,0,0,0.25);`;
  const heading = document.createElement('div');
  heading.textContent = title;
  heading.style.cssText = 'font-size:22px;font-weight:bold;margin-bottom:12px;';
  card.appendChild(heading);
  const inputs = fields.map((field) => {
    const label = document.createElement('label');
    label.style.cssText = 'display:block;font-size:15px;margin:8px 0 4px;';
    label.textContent = field.label;
    const input = document.createElement('input');
    input.value = field.value ?? '';
    input.maxLength = field.max;
    input.placeholder = field.placeholder ?? '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.cssText = `display:block;width:100%;box-sizing:border-box;font:bold 20px ${FONT_FAMILY};padding:8px 10px;border:2px solid ${toCss(PALETTE.ink)};border-radius:6px;text-transform:uppercase;`;
    label.appendChild(input);
    card.appendChild(label);
    return input;
  });
  if (note) {
    const small = document.createElement('div');
    small.textContent = note;
    small.style.cssText = 'font-size:13px;margin-top:10px;opacity:0.8;';
    card.appendChild(small);
  }
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:16px;';
  const button = (label: string, type: 'submit' | 'button', fill: number, ink: number) => {
    const b = document.createElement('button');
    b.type = type;
    b.textContent = label;
    b.style.cssText = `font:bold 18px ${FONT_FAMILY};padding:8px 18px;border:3px solid ${toCss(PALETTE.ink)};border-radius:6px;background:${toCss(fill)};color:${toCss(ink)};cursor:pointer;`;
    row.appendChild(b);
    return b;
  };
  const cancel = button('CANCEL', 'button', PALETTE.cream, PALETTE.ink);
  button('OK', 'submit', PALETTE.terracotta, PALETTE.cream);
  card.appendChild(row);
  shade.appendChild(card);
  host.appendChild(shade);
  inputs[0]?.focus();

  return new Promise((resolve) => {
    let done = false;
    const finish = (values: string[] | null) => {
      if (done) return;
      done = true;
      shade.remove();
      if (keyboard) {
        keyboard.enabled = true;
        keyboard.enableGlobalCapture();
        keyboard.resetKeys();
      }
      resolve(values);
    };
    card.addEventListener('submit', (event) => {
      event.preventDefault();
      finish(inputs.map((i) => i.value));
    });
    cancel.addEventListener('click', () => finish(null));
    shade.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') finish(null);
    });
    // Leaving the screen closes the card.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => finish(null));
  });
}
