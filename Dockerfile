FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production TABEL_HOST=0.0.0.0 PORT=3000 TABEL_DB=/app/data/tabel.sqlite
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
