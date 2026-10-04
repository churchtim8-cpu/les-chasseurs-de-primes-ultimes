/**
 * Bellevue en fête (Mr Henry, 2026-10-04): the town dresses up for Carnival
 * and for Christmas. Decorations are drawing only. By default they follow the
 * calendar: Carnival in the weeks up to Carnival Tuesday (47 days before
 * Easter), Christmas from 1 December to 6 January.
 */
export const FESTIVALS = ['CARNIVAL', 'CHRISTMAS'] as const;
export type Festival = (typeof FESTIVALS)[number];

export const FESTIVAL = {
  /** Carnival decorations go up this many days before Carnival Tuesday and come down on Ash Wednesday. */
  carnivalLeadDays: 21,
  /** Christmas: from 1 December to 6 January (month, day). */
  christmasFrom: [12, 1] as const,
  christmasTo: [1, 6] as const,
  /** Metres between bunting lines across a street, and between fairy-light bulbs along it. */
  buntingSpacing: 48,
  bulbSpacing: 6,
  /** One junction in this many gets a decorated corner (a Christmas tree or a Carnival feather fan). */
  cornerEvery: 3,
  /** Bright Carnival colours and Christmas light colours. */
  carnivalColours: [0xe63946, 0xf4a300, 0xffd60a, 0x2ec4b6, 0x3a86ff, 0x8338ec, 0xff4fa3, 0x06d6a0],
  christmasColours: [0xe63946, 0x2a9d4f, 0xffd166, 0x4cc9f0, 0xf8f8f8],
} as const;

/** Easter Sunday (Gregorian), as [month, day]: the anonymous Gregorian algorithm. */
export function easter(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

/** Day of the year for a month and day (1 January = 0), leap years included. */
function dayOfYear(year: number, month: number, day: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let n = day - 1;
  for (let m = 1; m < month; m++) n += lengths[m - 1] as number;
  return n;
}

/** Carnival Tuesday of a year, as a day of the year. */
export function carnivalTuesday(year: number): number {
  const [month, day] = easter(year);
  return dayOfYear(year, month, day) - 47;
}

/** The festival the town is dressed for on a date (YYYY-MM-DD), or null. */
export function festivalOn(date: string): Festival | null {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  if (!y || !m || !d) return null;
  const [fromM, fromD] = FESTIVAL.christmasFrom;
  const [toM, toD] = FESTIVAL.christmasTo;
  if ((m === fromM && d >= fromD) || (m === toM && d <= toD)) return 'CHRISTMAS';
  const today = dayOfYear(y, m, d);
  const tuesday = carnivalTuesday(y);
  if (today >= tuesday - FESTIVAL.carnivalLeadDays && today <= tuesday) return 'CARNIVAL';
  return null;
}
