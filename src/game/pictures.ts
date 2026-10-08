/**
 * The pictures come as WebP, about half the download of the JPEGs (40
 * students loading the game at once share the school's internet). A browser
 * that cannot show WebP gets the JPEG instead. scripts/make-webp.py makes the
 * WebP copies.
 */
const webp = (() => {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    return canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
})();

/** The address to load a .jpg picture from on this browser. */
export function picture(path: string): string {
  return webp ? path.replace(/\.jpg$/i, '.webp') : path;
}
