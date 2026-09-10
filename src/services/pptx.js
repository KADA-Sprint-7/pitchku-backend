const PptxGenJS = require("pptxgenjs");

/**
 * MESIN EKSPOR PPTX
 *
 * Aturan mutlak dari FRD: slide TIDAK BOLEH diekspor sebagai gambar.
 * Teks harus jadi objek teks native, kartu dan garis harus jadi shape native,
 * supaya pengguna bisa membuka dan menyunting hasilnya di PowerPoint.
 *
 * Kanvas 16:9 = 10 x 5.625 inci. Semua koordinat di bawah dalam inci.
 * Koordinat ini harus tetap sebanding dengan renderer web (basis 1280x720 px,
 * 128 px = 1 inci). Kalau salah satu berubah, ubah keduanya.
 */

const MARGIN = 0.55;
const CONTENT_W = 10 - MARGIN * 2; // 8.9
const FONT = "Arial"; // font aman di Windows, macOS, dan Google Slides
const INK = "1A1A1A";
const PANEL = "F5F7FA";
const PANEL_LINE = "E2E6EB";

const bare = (hex) => hex.replace("#", "").toUpperCase();

function isDark(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return true;
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16));
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

function buildFileName(businessName, template) {
  const d = new Date();
  const stamp =
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
  const safe = businessName.replace(/[^\w\u00C0-\u024F]+/g, "_").replace(/^_|_$/g, "");
  return `${safe || "Usaha"}_${template}_${stamp}.pptx`;
}

async function renderPptx(opts) {
  const { slides, brandKit, businessName } = opts;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "PitchKu";
  pptx.company = businessName;

  const P = bare(brandKit.primaryColor);
  const A = bare(brandKit.accentColor);

  const corner = (s) => {
    s.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN,
      y: 0.3,
      w: 0.17,
      h: 0.17,
      fill: { color: P },
      line: { color: P },
      rectRadius: 0.04,
    });
    s.addText(businessName, {
      x: MARGIN + 0.26,
      y: 0.27,
      w: 4,
      h: 0.24,
      fontSize: 11,
      fontFace: FONT,
      color: "6B6B6B",
      valign: "middle",
    });
  };

  const heading = (s, title) => {
    s.addText(title, {
      x: MARGIN,
      y: 0.72,
      w: CONTENT_W,
      h: 0.62,
      fontSize: 26,
      bold: true,
      fontFace: FONT,
      color: P,
      valign: "middle",
      shrinkText: true,
    });
    s.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN,
      y: 1.42,
      w: 0.75,
      h: 0.05,
      fill: { color: A },
      line: { color: A },
      rectRadius: 0.02,
    });
  };

  for (const sl of slides) {
    const s = pptx.addSlide();

    /* ---------------- title_slide ---------------- */
    if (sl.layout === "title_slide") {
      const light = isDark(brandKit.primaryColor);
      s.background = { color: P };
      s.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: 10,
        h: 0.08,
        fill: { color: A },
        line: { color: A },
      });
      s.addShape(pptx.ShapeType.roundRect, {
        x: 4.62,
        y: 0.75,
        w: 0.23,
        h: 0.23,
        fill: { color: A },
        line: { color: A },
        rectRadius: 0.05,
      });
      s.addText(businessName, {
        x: 4.95,
        y: 0.73,
        w: 3,
        h: 0.28,
        fontSize: 12,
        fontFace: FONT,
        color: light ? "E8E8E8" : "555555",
        valign: "middle",
      });
      s.addText(sl.title, {
        x: 1.0,
        y: 2.05,
        w: 8.0,
        h: 1.1,
        fontSize: 34,
        bold: true,
        align: "center",
        valign: "middle",
        fontFace: FONT,
        color: light ? "FFFFFF" : "101010",
        shrinkText: true,
      });
      if (sl.subtitle) {
        s.addText(sl.subtitle, {
          x: 1.5,
          y: 3.28,
          w: 7.0,
          h: 0.75,
          fontSize: 15,
          align: "center",
          valign: "top",
          fontFace: FONT,
          color: light ? "DCDCDC" : "444444",
          shrinkText: true,
        });
      }
      continue;
    }

    /* ---------------- title_bullets ---------------- */
    if (sl.layout === "title_bullets") {
      corner(s);
      heading(s, sl.title);
      const items = (sl.bullets ?? []).map((t) => ({
        text: t,
        options: { bullet: { code: "2022" }, breakLine: true },
      }));
      if (items.length) {
        s.addText(items, {
          x: MARGIN,
          y: 1.75,
          w: 5.0,
          h: 3.3,
          fontSize: 14,
          fontFace: FONT,
          color: INK,
          lineSpacingMultiple: 1.35,
          paraSpaceAfter: 8,
          valign: "top",
          shrinkText: true,
        });
      }
      if (sl.imageUrl) {
        s.addImage({ path: sl.imageUrl, x: 6.0, y: 1.37, w: 3.45, h: 3.28 });
      } else {
        s.addShape(pptx.ShapeType.roundRect, {
          x: 6.0,
          y: 1.37,
          w: 3.45,
          h: 3.28,
          fill: { color: "FFFFFF" },
          line: { color: A, width: 1, dashType: "dash" },
          rectRadius: 0.06,
        });
        s.addText(sl.imageQuery ?? "gambar produk", {
          x: 6.15,
          y: 2.75,
          w: 3.15,
          h: 0.6,
          fontSize: 11,
          align: "center",
          fontFace: FONT,
          color: "9A9A9A",
          shrinkText: true,
        });
      }
      continue;
    }

    /* ---------------- two_column ---------------- */
    if (sl.layout === "two_column") {
      corner(s);
      heading(s, sl.title);
      const bullets = sl.bullets ?? [];
      const mid = Math.ceil(bullets.length / 2);
      const cols =
        (sl.cards ?? []).length >= 2
          ? sl.cards.slice(0, 2)
          : [
              { header: "", description: bullets.slice(0, mid).join(" \u00B7 ") },
              { header: "", description: bullets.slice(mid).join(" \u00B7 ") },
            ];
      cols.forEach((c, i) => {
        const x = i === 0 ? MARGIN : 5.2;
        s.addShape(pptx.ShapeType.rect, {
          x,
          y: 1.75,
          w: 4.25,
          h: 3.05,
          fill: { color: PANEL },
          line: { color: PANEL_LINE, width: 0.75 },
        });
        s.addShape(pptx.ShapeType.rect, {
          x,
          y: 1.75,
          w: 4.25,
          h: 0.05,
          fill: { color: i === 0 ? P : A },
          line: { color: i === 0 ? P : A },
        });
        if (c.header) {
          s.addText(c.header, {
            x: x + 0.26,
            y: 2.0,
            w: 3.73,
            h: 0.45,
            fontSize: 16,
            bold: true,
            fontFace: FONT,
            color: P,
            valign: "middle",
            shrinkText: true,
          });
        }
        s.addText(c.description, {
          x: x + 0.26,
          y: c.header ? 2.5 : 2.05,
          w: 3.73,
          h: c.header ? 2.0 : 2.45,
          fontSize: 13,
          fontFace: FONT,
          color: INK,
          valign: "top",
          lineSpacingMultiple: 1.3,
          shrinkText: true,
        });
      });
      continue;
    }

    /* ---------------- metrics_grid ---------------- */
    if (sl.layout === "metrics_grid") {
      corner(s);
      heading(s, sl.title);
      const items = (sl.cards ?? []).slice(0, 4);
      const n = Math.max(items.length, 1);
      const gap = 0.22;
      const w = (CONTENT_W - gap * (n - 1)) / n;
      items.forEach((c, i) => {
        const x = MARGIN + i * (w + gap);
        s.addShape(pptx.ShapeType.rect, {
          x,
          y: 1.95,
          w,
          h: 2.35,
          fill: { color: PANEL },
          line: { color: PANEL_LINE, width: 0.75 },
        });
        s.addText(c.header, {
          x: x + 0.2,
          y: 2.25,
          w: w - 0.4,
          h: 0.75,
          fontSize: 30,
          bold: true,
          fontFace: FONT,
          color: A,
          valign: "middle",
          shrinkText: true,
        });
        s.addText(c.description, {
          x: x + 0.2,
          y: 3.05,
          w: w - 0.4,
          h: 1.05,
          fontSize: 12,
          fontFace: FONT,
          color: INK,
          valign: "top",
          lineSpacingMultiple: 1.25,
          shrinkText: true,
        });
      });
      if (sl.subtitle) {
        s.addText(sl.subtitle, {
          x: MARGIN,
          y: 4.45,
          w: CONTENT_W,
          h: 0.4,
          fontSize: 11,
          fontFace: FONT,
          color: "6B6B6B",
          shrinkText: true,
        });
      }
      continue;
    }

    /* ---------------- card_grid ---------------- */
    if (sl.layout === "card_grid") {
      corner(s);
      heading(s, sl.title);
      const items = (sl.cards ?? []).slice(0, 3);
      const n = Math.max(items.length, 1);
      const gap = 0.24;
      const w = (CONTENT_W - gap * (n - 1)) / n;
      items.forEach((c, i) => {
        const x = MARGIN + i * (w + gap);
        s.addShape(pptx.ShapeType.rect, {
          x,
          y: 1.9,
          w,
          h: 2.6,
          fill: { color: "FFFFFF" },
          line: { color: "DDE3EA", width: 0.75 },
        });
        s.addShape(pptx.ShapeType.rect, {
          x,
          y: 1.9,
          w: 0.06,
          h: 2.6,
          fill: { color: A },
          line: { color: A },
        });
        s.addText(c.header, {
          x: x + 0.28,
          y: 2.15,
          w: w - 0.5,
          h: 0.6,
          fontSize: 15,
          bold: true,
          fontFace: FONT,
          color: P,
          valign: "top",
          shrinkText: true,
        });
        s.addText(c.description, {
          x: x + 0.28,
          y: 2.8,
          w: w - 0.5,
          h: 1.5,
          fontSize: 12,
          fontFace: FONT,
          color: INK,
          valign: "top",
          lineSpacingMultiple: 1.3,
          shrinkText: true,
        });
      });
      continue;
    }

    /* ---------------- contact_closing ---------------- */
    s.background = { color: "F4F7FA" };
    s.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 5.53,
      w: 10,
      h: 0.095,
      fill: { color: A },
      line: { color: A },
    });
    s.addText(sl.title, {
      x: 1.0,
      y: 1.55,
      w: 8.0,
      h: 0.85,
      fontSize: 28,
      bold: true,
      align: "center",
      valign: "middle",
      fontFace: FONT,
      color: P,
      shrinkText: true,
    });
    if (sl.subtitle) {
      s.addText(sl.subtitle, {
        x: 1.6,
        y: 2.45,
        w: 6.8,
        h: 0.6,
        fontSize: 14,
        align: "center",
        fontFace: FONT,
        color: "4A4A4A",
        shrinkText: true,
      });
    }
    const lines = (sl.bullets ?? []).length ? sl.bullets : [businessName];
    s.addText(
      lines.map((t) => ({ text: t, options: { breakLine: true } })),
      {
        x: 1.0,
        y: 3.25,
        w: 8.0,
        h: 1.6,
        fontSize: 14,
        align: "center",
        valign: "top",
        fontFace: FONT,
        color: "2B2B2B",
        lineSpacingMultiple: 1.5,
        shrinkText: true,
      }
    );
  }

  // "nodebuffer" penting: konversi murni di memori, tidak menulis berkas
  // fisik ke disk server. Ini mitigasi risiko timeout dari FRD.
  const out = await pptx.write({ outputType: "nodebuffer" });
  return out;
}

module.exports = { renderPptx, buildFileName };
