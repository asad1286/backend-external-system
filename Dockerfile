# One image for the whole External System: the backend serves the built frontend.
#   docker build -t external-system .
#   docker run -p 8000:8000 -e PORT=8000 -e APP_PASSWORD=… -e CLIENT_ID=… -e CLIENT_SECRET=… external-system

FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine
ENV NODE_ENV=production PORT=8000 FRONTEND_DIST=/app/frontend/dist
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/src ./src
COPY --from=frontend /app/frontend/dist /app/frontend/dist
EXPOSE 8000
RUN mkdir -p data && chown node:node data
USER node
CMD ["node", "src/server.js"]
