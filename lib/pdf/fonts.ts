import "server-only";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

let registered = false;

/**
 * Registers the Heebo font family with @react-pdf/renderer.
 *
 * Uses the variable-weight Heebo TTF from Google Fonts (Heebo[wght].ttf, 122KB)
 * which ships both Hebrew and Latin glyphs in a single file. We register the
 * same file three times with different `fontWeight` values; fontkit picks the
 * correct weight axis instance at render time. Mixed-language text renders
 * entirely in Heebo without falling back to Helvetica.
 *
 * Idempotent — safe to call from multiple renders.
 */
export function ensureFontsRegistered(): void {
  if (registered) return;

  const ttf = path.join(process.cwd(), "public", "fonts", "Heebo-VF.ttf");

  Font.register({
    family: "Heebo",
    fonts: [
      { src: ttf, fontWeight: "normal" },
      { src: ttf, fontWeight: 600 },
      { src: ttf, fontWeight: "bold" },
    ],
  });

  // Hebrew does not hyphenate at line breaks; disable the default behavior.
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}
