FROM node:20-alpine

RUN apk add --no-cache \
    git \
    curl \
    bash \
    openssl \
    docker-cli \
    docker-cli-compose \
    openssh-client && \
    git config --global --add safe.directory '*'

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm install

COPY tsconfig.json tsconfig.frontend.json vite.config.ts ./
COPY frontend ./frontend
COPY src ./src
COPY public ./public

RUN npm run build

EXPOSE 9000

CMD ["npm", "run", "start"]
