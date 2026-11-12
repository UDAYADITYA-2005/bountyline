import { studioTheme } from 'ag-studio';

/** Reads a design token from :root so the Studio theme follows tokens.css. */
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** The Studio theme built from Bountyline's design tokens (light or dark, per the page). */
export function createDeskTheme() {
  return studioTheme.withParams({
    accentColor: token('--bl-color-brand', '#0d3b3a'),
    backgroundColor: token('--bl-color-surface', '#fffdf8'),
    foregroundColor: token('--bl-color-ink', '#12201f'),
    textColor: token('--bl-color-ink', '#12201f'),
    subtleTextColor: token('--bl-color-ink-muted', '#4a5655'),
    borderColor: token('--bl-color-line', '#cfc7b6'),
    borderRadius: 6,
    fontFamily: token('--bl-font-sans', 'system-ui, sans-serif'),
    fontSize: 13,
    studioWrapperBackgroundColor: token('--bl-color-bg', '#f4f1ea'),
    studioCanvasBackgroundColor: token('--bl-color-bg', '#f4f1ea'),
  });
}
