FROM node:22-slim

WORKDIR /app

# Copy and install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Copy server source and built client
COPY server/ ./server/
COPY client/dist/ ./client/dist/

EXPOSE 3001

CMD ["node", "server/index.js"]
