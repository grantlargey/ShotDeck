// Synthetic three-page screenplay used by the browser smoke. Coordinates are
// PDF points on US Letter pages and match the viewer's screenplay test pages.
const PAGE_HEIGHT = 792;
const ACTION = 108;
const DIALOGUE = 180;
const PARENTHETICAL = 216;
const CUE = 252;
const TRANSITION = 450;

const pages = [
  [
    [ACTION, 96, "INT. DINER - NIGHT"],
    [ACTION, 120, "Rain streaks the windows of an empty roadside diner at"],
    [ACTION, 132, "midnight. MAYA, thirties, wipes the counter in slow circles."],
    [ACTION, 156, "A bell over the door rings. SAM steps in from the storm,"],
    [ACTION, 168, "shaking water from a battered canvas coat and hat."],
    [CUE, 192, "MAYA"],
    [DIALOGUE, 204, "Kitchen closed an hour ago."],
    [DIALOGUE, 216, "Coffee is all I can do."],
  ],
  [
    [CUE, 96, "SAM"],
    [PARENTHETICAL, 108, "(quietly)"],
    [DIALOGUE, 120, "Then coffee. And the booth"],
    [DIALOGUE, 132, "by the window."],
    [ACTION, 156, "Maya pours two cups and slides one across the counter."],
    [TRANSITION, 180, "CUT TO:"],
  ],
  [
    [ACTION, 96, "EXT. PARKING LOT - NIGHT"],
    [ACTION, 120, "Headlights sweep across the gravel as a truck pulls in slow."],
    [ACTION, 132, "Its engine ticks in the cold while the wipers keep going."],
    [ACTION, 156, "Inside the cab, a figure watches the diner window and waits."],
    [ACTION, 168, "Nobody gets out, and nobody in the diner seems to notice."],
  ],
];

function escapePdfText(text) {
  return text.replace(/[\\()]/g, (match) => `\\${match}`);
}

/** Returns a deterministic PDF buffer without needing a PDF-writing dependency. */
export function makeSyntheticPdf() {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalog = add(null);
  const pagesRoot = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const kids = [];
  for (const lines of pages) {
    const content = lines
      .map(
        ([x, y, value]) =>
          `BT /F1 12 Tf 1 0 0 1 ${x} ${PAGE_HEIGHT - y} Tm (${escapePdfText(value)}) Tj ET`
      )
      .join("\n");
    const stream = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 612 ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`
      )
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
  objects[pagesRoot - 1] =
    `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
