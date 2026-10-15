FROM node:20-alpine

RUN apk add --no-cache \
    git \
    curl \
    bash \
    docker-cli \
    docker-cli-compose \
    openssh-client && \
    git config --global --add safe.directory '*'

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY public ./public

RUN npm run build

EXPOSE 9000

CMD ["npm", "run", "start"]
