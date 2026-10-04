/**
 * The online class board for Le défi du jour (Mr Henry chose it, 2026-10-04).
 * It is switched off until his free Supabase project's address and public key
 * go here. The "anon public" key is meant to be in the page: the database only
 * lets it read the boards, add a first try, and remove a line with the
 * teacher PIN (docs/online-board-setup.md). Never put the service_role key here.
 */
export const SUPABASE = {
  url: '',
  anonKey: '',
};

export interface OnlineConfig {
  url: string;
  key: string;
}

/** The online board's address and key, or null while it is switched off. `?debug=1&online=<address>` points at a test server. */
export function onlineConfig(): OnlineConfig | null {
  const params = new URLSearchParams(window.location.search);
  const test = params.get('debug') === '1' ? params.get('online') : null;
  if (test) return { url: test.replace(/\/+$/, ''), key: 'test' };
  return SUPABASE.url && SUPABASE.anonKey ? { url: SUPABASE.url.replace(/\/+$/, ''), key: SUPABASE.anonKey } : null;
}
