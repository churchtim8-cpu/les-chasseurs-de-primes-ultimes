/** The game's canvas size (it scales to fit the window). */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;
/** Texture key of the AI title picture (images/title.jpg). */
export const TITLE_PICTURE = 'title-picture';
/** The full-screen button, top right on every screen (screens keep that corner clear). */
export const FULLSCREEN_BUTTON = { x: GAME_WIDTH - 34, y: 34, size: 40 } as const;
