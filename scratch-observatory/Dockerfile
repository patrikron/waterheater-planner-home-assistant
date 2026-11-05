FROM node:22-alpine
WORKDIR /app
COPY server.mjs config.json ./
COPY public ./public
USER node
EXPOSE 8780
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8780/healthz || exit 1
CMD ["node", "server.mjs"]
