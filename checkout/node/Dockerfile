# Build from the checkout folder, so the image includes the shared frontend:
#   docker build -f checkout/node/Dockerfile checkout
FROM node:22-slim
WORKDIR /app
COPY node/package.json node/package-lock.json node/
RUN cd node && npm ci --omit=dev
COPY node/ node/
COPY frontend/ frontend/
WORKDIR /app/node
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.js"]
