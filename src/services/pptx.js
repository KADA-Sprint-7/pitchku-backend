const PptxGenJS = require("pptxgenjs");

/**
 * MESIN EKSPOR PPTX
 *
 * Aturan mutlak dari FRD: slide TIDAK BOLEH diekspor sebagai gambar.
 * Teks harus jadi objek teks native, kartu dan garis harus jadi shape native,
 * supaya pengguna bisa membuka dan menyunting hasilnya di PowerPoint.
 *
 * SUMBER DESAIN: kanvas editor di pitchku-frontend
 * (src/components/SlideEditor/SlideLayoutRenderer.jsx + SlideCanvas.jsx).
 * Kanvas web berukuran 960 x 540 px, jadi 96 px = 1 inci dan 1 px = 0.75 pt.
 * Semua angka di bawah diturunkan langsung dari nilai Tailwind di renderer itu
 * lewat px() dan pt(), supaya hasil unduhan sama dengan yang dilihat pengguna
 * di layar. Kalau renderer web berubah, ubah berkas ini juga.
 */

/* ---------------------------------------------------------------- ukuran */

const px = (n) => n / 96; // px kanvas web -> inci
const pt = (n) => n * 0.75; // px kanvas web -> poin teks

const PW = 10; // lebar slide 16:9 (inci)
const PH = 5.625; // tinggi slide 16:9 (inci)

const CHROME_PAD = px(24); // padding badge bab, logo, dan footer
const PAD = px(40); // padding isi slide (px-10 di renderer)
const HEADER_H = px(32); // pt-8 pada area konten
const FOOTER_H = px(28); // tinggi bar footer

const TOP = HEADER_H; // batas atas area konten
const BOTTOM = PH - FOOTER_H; // batas bawah area konten
const AREA_H = BOTTOM - TOP; // 5.0 inci
const BODY_W = PW - PAD * 2; // 9.1667 inci

/* ----------------------------------------------------------------- warna */

const BG = "070C15"; // latar kanvas
const PANEL = "0F1A2E"; // latar kartu
const PANEL_LINE = "1E293B"; // border kartu (slate-800)
const PLACEHOLDER = "0B1326"; // kotak gambar kosong
const WHITE = "FFFFFF";
const SLATE_200 = "E2E8F0";
const SLATE_300 = "CBD5E1";
const SLATE_400 = "94A3B8";

const bare = (hex) => String(hex ?? "").replace("#", "").toUpperCase();

/** Campur dua warna. PowerPoint tidak punya border semi-transparan, jadi
 *  warna tembus pandang di CSS dihitung sendiri di atas latar gelap. */
function mix(fg, bg, alpha) {
  const f = bare(fg);
  const b = bare(bg);
  let out = "";
  for (let i = 0; i < 6; i += 2) {
    const v =
      parseInt(f.slice(i, i + 2), 16) * alpha +
      parseInt(b.slice(i, i + 2), 16) * (1 - alpha);
    out += Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  }
  return out.toUpperCase();
}

const FOOTER_BG = mix("000000", BG, 0.4); // bg-black/40
const FOOTER_LINE = mix(WHITE, BG, 0.05); // border-white/5

function luminance(hex) {
  const h = bare(hex);
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * Warna merek dipakai untuk teks kecil dan garis tipis di atas latar gelap.
 * Merek bernuansa gelap (mis. #0F4C81) nyaris hilang di sana, dan berkas PPTX
 * sering diproyeksikan, tidak bisa di-zoom seperti di aplikasi. Jadi warna
 * yang terlalu gelap dicerahkan seperlunya; identitasnya tetap terbaca.
 */
function onDark(hex) {
  let c = bare(hex);
  if (!/^[0-9A-F]{6}$/.test(c)) return SLATE_400;
  for (let i = 0; i < 8 && luminance(c) < 0.18; i++) c = mix(WHITE, c, 0.18);
  return c;
}

/* ------------------------------------------------------------------ teks */

/** brandKit.fontFamily boleh berisi daftar CSS ("Inter, sans-serif").
 *  PPTX hanya menerima satu nama font. */
function fontOf(brandKit) {
  const raw = String(brandKit?.fontFamily ?? "").split(",")[0].trim();
  return raw.replace(/^["']|["']$/g, "") || "Inter";
}

const LAYOUT_LABELS = {
  title_slide: "Cover",
  title_bullets: "Penjelasan",
  two_column: "Komparasi",
  metrics_grid: "Metrik",
  card_grid: "Konten",
  contact_closing: "Penutup",
};

const has = (v) => typeof v === "string" && v.trim().length > 0;
const filled = (arr) =>
  (arr ?? []).filter((c) => has(c?.header) || has(c?.description));

/* ---------------------------------------------------------------- gambar */

/**
 * Gambar diambil lebih dulu di sini, bukan diserahkan ke pptxgenjs lewat
 * `path`. Satu URL mati atau server lambat kalau tidak begini bisa
 * menggantung atau menggagalkan seluruh ekspor; dengan pra-ambil, slide itu
 * cukup jatuh ke kotak placeholder dan berkasnya tetap jadi.
 */
const IMG_TIMEOUT_MS = 6000;
const IMG_MAX_BYTES = 5 * 1024 * 1024;

async function fetchImage(url) {
  if (!/^https?:\/\//i.test(String(url ?? ""))) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMG_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!type.startsWith("image/") || type === "image/svg+xml") return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > IMG_MAX_BYTES) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- berkas */

function buildFileName(businessName, template) {
  const d = new Date();
  const stamp =
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
  const safe = String(businessName ?? "")
    .replace(/[^\wÀ-ɏ]+/g, "_")
    .replace(/^_|_$/g, "");
  return `${safe || "Usaha"}_${template}_${stamp}.pptx`;
}

/* ---------------------------------------------------------------- render */

async function renderPptx(opts) {
  const { slides, brandKit, businessName, deckTitle } = opts;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "PitchKu";
  pptx.company = businessName;
  pptx.title = has(deckTitle) ? deckTitle : businessName;

  const FONT = fontOf(brandKit);
  const Praw = bare(brandKit.primaryColor);
  const Araw = bare(brandKit.accentColor);
  const P = onDark(Praw); // untuk teks kecil dan garis tipis
  const A = onDark(Araw);

  const footerTitle = has(deckTitle) ? deckTitle : businessName;
  const total = slides.length;

  // Semua gambar diambil sekali, paralel, sebelum slide disusun.
  const [logoData, slideImages] = await Promise.all([
    brandKit.logoUrl ? fetchImage(brandKit.logoUrl) : null,
    Promise.all(slides.map((sl) => (sl.imageUrl ? fetchImage(sl.imageUrl) : null))),
  ]);

  /* ------------------------------------------------------- alat gambar */

  const text = (s, str, o) => {
    if (!has(str)) return;
    s.addText(String(str), {
      fontFace: FONT,
      color: WHITE,
      valign: "top",
      wrap: true,
      shrinkText: true,
      // PowerPoint memberi kotak teks padding bawaan 0,1 inci. Di kanvas web
      // tidak ada, jadi dinolkan supaya teks sejajar dengan garis dan kartu.
      margin: 0,
      ...o,
    });
  };

  const bar = (s, x, y, w, h, color) => {
    s.addShape(pptx.ShapeType.roundRect, {
      x,
      y,
      w,
      h,
      rectRadius: h / 2,
      fill: { color },
      line: { color },
    });
  };

  const card = (s, x, y, w, h, lineColor) => {
    s.addShape(pptx.ShapeType.roundRect, {
      x,
      y,
      w,
      h,
      rectRadius: px(12), // rounded-xl
      fill: { color: PANEL },
      line: { color: lineColor ?? PANEL_LINE, width: 1 },
    });
  };

  /** Gambar dipotong ala object-cover. Kalau tidak ada gambar, jatuh ke panel
   *  kosong seperti kotak placeholder di editor. */
  const picture = (s, data, x, y, w, h, radius) => {
    if (data) {
      s.addImage({ data, x, y, w, h, sizing: { type: "cover", w, h } });
      return;
    }
    s.addShape(radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
      x,
      y,
      w,
      h,
      ...(radius ? { rectRadius: radius } : {}),
      fill: { color: PLACEHOLDER },
      line: { color: PANEL_LINE, width: 1 },
    });
  };

  /* --------------------------------- bingkai tetap: badge, logo, footer */

  const chrome = (s, sl, num) => {
    const label = `BAB ${String(num).padStart(2, "0")} • ${(
      LAYOUT_LABELS[sl.layout] ?? "Slide"
    ).toUpperCase()}`;

    const badgeW = Math.min(3.1, Math.max(1.2, 0.42 + label.length * 0.062));
    s.addShape(pptx.ShapeType.roundRect, {
      x: CHROME_PAD,
      y: px(12),
      w: badgeW,
      h: px(21),
      rectRadius: px(10.5),
      fill: { color: mix(Araw, BG, 0.15) },
      line: { color: mix(Araw, BG, 0.4), width: 1 },
    });
    s.addText(label, {
      x: CHROME_PAD,
      y: px(12),
      w: badgeW,
      h: px(21),
      fontSize: 7,
      bold: true,
      charSpacing: 0.7, // tracking-widest
      color: A,
      fontFace: FONT,
      align: "center",
      valign: "middle",
      margin: 0,
    });

    // Logo hanya di slide non-cover, sama seperti di editor.
    if (logoData && sl.layout !== "title_slide") {
      const lw = px(90);
      const lh = px(22);
      s.addImage({
        data: logoData,
        x: PW - CHROME_PAD - lw,
        y: px(11),
        w: lw,
        h: lh,
        sizing: { type: "contain", w: lw, h: lh },
      });
    }

    s.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: BOTTOM,
      w: PW,
      h: FOOTER_H,
      fill: { color: FOOTER_BG },
      line: { color: FOOTER_LINE, width: 0.75 },
    });
    s.addText(footerTitle, {
      x: CHROME_PAD,
      y: BOTTOM,
      w: 6.2,
      h: FOOTER_H,
      fontSize: 7,
      color: SLATE_400,
      fontFace: FONT,
      valign: "middle",
      shrinkText: true,
      margin: 0,
    });
    s.addText(
      `${String(num).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
      {
        x: PW - CHROME_PAD - 1.4,
        y: BOTTOM,
        w: 1.4,
        h: FOOTER_H,
        fontSize: 7,
        color: SLATE_400,
        fontFace: FONT,
        align: "right",
        valign: "middle",
        margin: 0,
      }
    );
  };

  /** Judul slide + garis aksen, dipakai empat layout isi. */
  const headingH = px(2) + px(12) + 0.45;
  const heading = (s, title, y) => {
    bar(s, PAD, y, px(32), px(2), A);
    text(s, title, {
      x: PAD,
      y: y + px(2) + px(12),
      w: BODY_W,
      h: 0.45,
      fontSize: pt(20),
      bold: true,
    });
    return headingH;
  };

  /* ------------------------------------------------------------ slides */

  slides.forEach((sl, idx) => {
    const s = pptx.addSlide();
    const num = sl.slideNumber ?? idx + 1;
    const img = slideImages[idx];

    s.background = { color: BG };
    chrome(s, sl, num);

    /* ---------------- title_slide ---------------- */
    if (sl.layout === "title_slide") {
      const imgX = PW * 0.62;
      picture(s, img, imgX, TOP, PW * 0.38, AREA_H, 0);
      s.addShape(pptx.ShapeType.rect, {
        x: imgX,
        y: TOP,
        w: 0.012,
        h: AREA_H,
        fill: { color: PANEL_LINE },
        line: { color: PANEL_LINE },
      });

      const w = imgX - PAD * 2;
      const titleH = 0.9;
      const subH = 0.62;
      const blockH =
        px(4) + px(16) + titleH + (has(sl.subtitle) ? px(12) + subH : 0);
      let y = TOP + (AREA_H - blockH) / 2;

      bar(s, PAD, y, px(40), px(4), A);
      y += px(4) + px(16);
      text(s, sl.title, { x: PAD, y, w, h: titleH, fontSize: pt(30), bold: true });
      y += titleH + px(12);
      text(s, sl.subtitle, {
        x: PAD,
        y,
        w,
        h: subH,
        fontSize: pt(14),
        color: SLATE_300,
        lineSpacingMultiple: 1.4,
      });
      return;
    }

    /* ---------------- title_bullets ---------------- */
    if (sl.layout === "title_bullets") {
      const boxW = px(192); // w-48
      const boxH = AREA_H * 0.85;
      picture(s, img, PW - PAD - boxW, TOP + (AREA_H - boxH) / 2, boxW, boxH, px(12));

      const w = BODY_W - boxW - px(24); // sisakan gap-6 ke gambar
      const bullets = (sl.bullets ?? []).filter(has).slice(0, 5);
      const titleH = 0.5;
      const subH = 0.3;
      const rowH = 0.42;
      const blockH =
        px(2) +
        px(12) +
        titleH +
        (has(sl.subtitle) ? px(4) + subH : 0) +
        (bullets.length ? px(14) + bullets.length * rowH : 0);
      let y = TOP + (AREA_H - blockH) / 2;

      bar(s, PAD, y, px(32), px(2), A);
      y += px(2) + px(12);
      text(s, sl.title, { x: PAD, y, w, h: titleH, fontSize: pt(24), bold: true });
      y += titleH;
      if (has(sl.subtitle)) {
        y += px(4);
        text(s, sl.subtitle, {
          x: PAD,
          y,
          w,
          h: subH,
          fontSize: pt(12),
          color: SLATE_400,
        });
        y += subH;
      }
      if (bullets.length) y += px(14);
      bullets.forEach((b, i) => {
        const by = y + i * rowH;
        s.addShape(pptx.ShapeType.ellipse, {
          x: PAD,
          y: by + px(7),
          w: px(6),
          h: px(6),
          fill: { color: A },
          line: { color: A },
        });
        text(s, b, {
          x: PAD + px(16),
          y: by,
          w: w - px(16),
          h: rowH - px(4),
          fontSize: pt(12),
          color: SLATE_200,
          lineSpacingMultiple: 1.35,
        });
      });
      return;
    }

    /* ---------------- two_column ---------------- */
    if (sl.layout === "two_column") {
      const gap = px(16);
      const colW = (BODY_W - gap) / 2;
      const colH = 1.35;
      let y = TOP + (AREA_H - (headingH + px(12) + colH)) / 2;

      y += heading(s, sl.title, y) + px(12);

      const bullets = (sl.bullets ?? []).filter(has);
      const mid = Math.ceil(bullets.length / 2);
      const cards = filled(sl.cards);
      const cols = cards.length
        ? cards.slice(0, 2)
        : [
            { header: "", description: bullets.slice(0, mid).join(" · ") },
            { header: "", description: bullets.slice(mid).join(" · ") },
          ];

      [0, 1].forEach((i) => {
        const c = cols[i] ?? {};
        const x = PAD + i * (colW + gap);
        card(s, x, y, colW, colH);
        bar(s, x + px(16), y + px(16), px(24), px(2), i === 0 ? P : A);
        text(s, c.header, {
          x: x + px(16),
          y: y + px(26),
          w: colW - px(32),
          h: 0.34,
          fontSize: pt(14),
          bold: true,
        });
        text(s, c.description, {
          x: x + px(16),
          y: y + (has(c.header) ? px(62) : px(26)),
          w: colW - px(32),
          h: colH - (has(c.header) ? px(78) : px(42)),
          fontSize: pt(12),
          color: SLATE_300,
          lineSpacingMultiple: 1.35,
        });
      });
      return;
    }

    /* ---------------- metrics_grid ---------------- */
    if (sl.layout === "metrics_grid") {
      const gap = px(12);
      const cw = (BODY_W - gap) / 2;
      const ch = 1.25;
      const cards = filled(sl.cards).slice(0, 4);
      const rows = Math.max(1, Math.ceil(cards.length / 2));
      const gridH = rows * ch + (rows - 1) * gap;
      let y = TOP + (AREA_H - (headingH + px(12) + gridH)) / 2;

      y += heading(s, sl.title, y) + px(12);

      cards.forEach((c, i) => {
        const x = PAD + (i % 2) * (cw + gap);
        const cy = y + Math.floor(i / 2) * (ch + gap);
        const lead = i === 0; // kartu pertama disorot, sama seperti di editor
        card(s, x, cy, cw, ch, lead ? mix(Araw, BG, 0.6) : PANEL_LINE);
        text(s, `METRIK ${i + 1}`, {
          x: x + px(14),
          y: cy + px(12),
          w: cw - px(28),
          h: 0.2,
          fontSize: 7,
          bold: true,
          charSpacing: 0.7,
          color: lead ? A : P,
        });
        text(s, c.header, {
          x: x + px(14),
          y: cy + px(32),
          w: cw - px(28),
          h: 0.45,
          fontSize: pt(24),
          bold: true,
        });
        text(s, c.description, {
          x: x + px(14),
          y: cy + px(78),
          w: cw - px(28),
          h: ch - px(90),
          fontSize: pt(11),
          color: SLATE_300,
        });
      });
      return;
    }

    /* ---------------- card_grid ---------------- */
    if (sl.layout === "card_grid") {
      const gap = px(10);
      const cw = (BODY_W - gap) / 2;
      const ch = 1.2;
      const cards = filled(sl.cards).slice(0, 4);
      const rows = Math.max(1, Math.ceil(cards.length / 2));
      const gridH = rows * ch + (rows - 1) * gap;
      let y = TOP + (AREA_H - (headingH + px(12) + gridH)) / 2;

      y += heading(s, sl.title, y) + px(12);

      cards.forEach((c, i) => {
        const x = PAD + (i % 2) * (cw + gap);
        const cy = y + Math.floor(i / 2) * (ch + gap);
        card(s, x, cy, cw, ch);
        bar(s, x + px(12), cy + px(12), px(16), px(2), A);
        text(s, c.header, {
          x: x + px(12),
          y: cy + px(22),
          w: cw - px(24),
          h: 0.3,
          fontSize: pt(12),
          bold: true,
        });
        text(s, c.description, {
          x: x + px(12),
          y: cy + px(54),
          w: cw - px(24),
          h: ch - px(66),
          fontSize: pt(11),
          color: SLATE_300,
          lineSpacingMultiple: 1.3,
        });
      });
      return;
    }

    /* ---------------- contact_closing ---------------- */
    const blockW = px(512); // max-w-lg
    const blockX = (PW - blockW) / 2;
    const gap = px(10);
    const cw = (blockW - gap) / 2;
    const ch = 0.62;
    const cards = filled(sl.cards).slice(0, 4);
    const lines = cards.length ? [] : (sl.bullets ?? []).filter(has);
    const rows = Math.ceil(cards.length / 2);

    const titleH = 0.5;
    const subH = 0.35;
    const gridH = rows ? rows * ch + (rows - 1) * gap : 0;
    const linesH = lines.length * 0.3;
    const blockH =
      px(4) +
      px(12) +
      titleH +
      (has(sl.subtitle) ? px(6) + subH : 0) +
      (gridH || linesH ? px(16) + gridH + linesH : 0);
    let y = TOP + (AREA_H - blockH) / 2;

    bar(s, PW / 2 - px(20), y, px(40), px(4), A);
    y += px(4) + px(12);
    text(s, sl.title, {
      x: blockX,
      y,
      w: blockW,
      h: titleH,
      fontSize: pt(24),
      bold: true,
      align: "center",
    });
    y += titleH;
    if (has(sl.subtitle)) {
      y += px(6);
      text(s, sl.subtitle, {
        x: blockX,
        y,
        w: blockW,
        h: subH,
        fontSize: pt(12),
        color: SLATE_300,
        align: "center",
        lineSpacingMultiple: 1.35,
      });
      y += subH;
    }
    if (gridH || linesH) y += px(16);

    cards.forEach((c, i) => {
      const x = blockX + (i % 2) * (cw + gap);
      const cy = y + Math.floor(i / 2) * (ch + gap);
      card(s, x, cy, cw, ch);
      text(s, String(c.header ?? "").toUpperCase(), {
        x: x + px(10),
        y: cy + px(8),
        w: cw - px(20),
        h: 0.2,
        fontSize: 7,
        bold: true,
        charSpacing: 0.3, // tracking-wide
        color: SLATE_400,
      });
      text(s, c.description, {
        x: x + px(10),
        y: cy + px(28),
        w: cw - px(20),
        h: ch - px(36),
        fontSize: pt(12),
      });
    });

    // Tanpa kartu kontak, bullets dipakai apa adanya sebagai baris kontak.
    lines.forEach((line, i) => {
      text(s, line, {
        x: blockX,
        y: y + i * 0.3,
        w: blockW,
        h: 0.28,
        fontSize: pt(12),
        color: SLATE_200,
        align: "center",
      });
    });
  });

  // "nodebuffer" penting: konversi murni di memori, tidak menulis berkas
  // fisik ke disk server. Ini mitigasi risiko timeout dari FRD.
  const out = await pptx.write({ outputType: "nodebuffer" });
  return out;
}

module.exports = { renderPptx, buildFileName };
