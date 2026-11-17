// Text layout shared by the editor (on screen) and the worker (in the PDF). No imports.

/** Line height as a multiple of the font size. */
export const LINE_HEIGHT = 1.25;
/** Inner padding of a text box, points. */
export const TEXT_PAD = 2;

/** Breaks text into lines that fit `width` (words, then characters for very long words). */
export function wrapLines(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n')) {
    const words = para.split(/(\s+)/).filter((w) => w.length > 0);
    let line = '';
    for (const w of words) {
      const trial = line + w;
      if (!line || measure(trial.trimEnd()) <= width) {
        line = trial;
        continue;
      }
      out.push(line.trimEnd());
      line = /^\s+$/.test(w) ? '' : w;
      while (measure(line) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > width) cut -= 1;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

