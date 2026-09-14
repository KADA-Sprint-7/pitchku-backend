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
app.use(express.json({ limit: "2mb" }));

const openApiDoc = buildOpenApiDoc();

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
