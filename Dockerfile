# slim, bukan alpine. Alpine memakai musl libc yang sering gagal meresolusi
# hostname *.railway.internal (IPv6) dari dalam container.
FROM node:22-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "src/index.js"]
