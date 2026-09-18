const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const { env } = require("./env");
const { buildOpenApiDoc } = require("./openapi");
const { generateRouter } = require("./routes/generate");
const { exportRouter } = require("./routes/exportPptx");
const { brandKitRouter } = require("./routes/brandKit");
const { projectsRouter } = require("./routes/projects");

const app = express();

/**
 * trim() wajib di sini. Di dashboard Render orang biasa menulis
 * "https://a.vercel.app, https://b.vercel.app" dengan spasi setelah koma,
 * dan origin yang berawal spasi tidak akan pernah cocok - hasilnya error
 * CORS yang membingungkan padahal domainnya sudah benar.
 */
const allowedOrigins = env.corsOrigin
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins, credentials: true }));

/**
 * fetchApi di pitchku-frontend membaca pesan error dari field `message`,
 * sedangkan semua route di sini mengirim `error`. Tanpa ini pengguna hanya
 * melihat "API Error: Bad Request". Dipasang sebelum parser JSON supaya
 * error body yang terlalu besar atau rusak juga ikut membawa pesan.
 */
app.use((_req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body === "object" && body.error && !body.message) {
      body = { ...body, message: body.detail ? `${body.error}: ${body.detail}` : body.error };
    }
    return json(body);
  };
  next();
});

// Logo dan gambar unggahan editor dikirim sebagai data URL base64. Logo
// dibatasi 2 MB di frontend, yang jadi sekitar 2,7 MB setelah base64.
app.use(express.json({ limit: "10mb" }));

const openApiDoc = buildOpenApiDoc();

/**
 * Root sengaja tidak dibiarkan 404. Orang yang pertama kali diberi URL
 * backend ini - penguji, juri, anggota tim baru - hampir selalu membuka
 * domain polosnya lebih dulu, bukan /docs. Balasan 404 di situ terbaca
 * seperti servernya mati, padahal hidup.
 */
app.get("/", (_req, res) =>
  res.json({
    message: "Hello, this is PitchKu backend",
    service: "pitchku-backend",
    version: "0.1.0",
    docs: "/docs",
    health: "/health",
    openapi: "/openapi.json",
  })
);

app.get("/health", (_req, res) => res.json({ ok: true, version: "0.1.0" }));
app.get("/openapi.json", (_req, res) => res.json(openApiDoc));
app.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiDoc, { customSiteTitle: "PitchKu API" })
);

app.use("/api/generate", generateRouter);
app.use("/api/export", exportRouter);
app.use("/api/brand-kit", brandKitRouter);
app.use("/api/projects", projectsRouter);

app.use((_req, res) => res.status(404).json({ error: "Endpoint tidak ada" }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // Error dari parser body (JSON rusak, body terlalu besar) membawa status
  // 4xx sendiri. Itu kesalahan permintaan, bukan kesalahan server.
  const status = err?.status ?? err?.statusCode;
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: "Permintaan tidak valid", detail: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Kesalahan server", detail: err?.message });
});

if (require.main === module) {
  app.listen(env.port, () => {
    console.log(`PitchKu API  http://localhost:${env.port}`);
    console.log(`Swagger      http://localhost:${env.port}/docs`);
  });
}

module.exports = { app };
