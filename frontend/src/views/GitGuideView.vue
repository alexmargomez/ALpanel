<script setup lang="ts">
import { copyText } from '../composables/usePanelStore';

const fullstackYaml = `services:
  db:
    image: mariadb:11 # o postgres:15-alpine
    container_name: miapp_db
    restart: unless-stopped
    env_file: .env
    ports:
      - "3308:3306"
    volumes:
      - db_data:/var/lib/mysql

  backend:
    build: ./backend
    container_name: miapp_backend
    restart: unless-stopped
    env_file: .env
    ports:
      - "8081:8080"
    depends_on:
      - db

  frontend:
    build: ./frontend
    container_name: miapp_frontend
    restart: unless-stopped
    ports:
      - "3001:80"
    depends_on:
      - backend

volumes:
  db_data:`;

const dockerfilesExamples = `# --- OPCIÓN A: Node.js / NestJS ---
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["npm", "run", "start:prod"]

# --- OPCIÓN B: Java 21 (Spring Boot) ---
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY . .
RUN mvn clean package -DskipTests
FROM eclipse-temurin:21-jre-alpine
COPY --from=build /app/target/*.jar /app.jar
ENTRYPOINT ["java", "-Xmx512m", "-jar", "/app.jar"]

# --- OPCIÓN C: PHP 8.2 / Laravel ---
FROM php:8.2-fpm-alpine
RUN docker-php-ext-install pdo pdo_mysql
WORKDIR /var/www/html
COPY . .
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]`;
</script>

<template>
  <section class="space-y-6">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
      <h3 class="text-base font-bold text-white">
        <i class="fa-solid fa-sitemap text-indigo-400 mr-2"></i>
        Estándar de Estructura para Proyectos en ALpanel (Node, Python, Java, Laravel)
      </h3>
      <p class="text-xs text-slate-300 leading-relaxed">
        Para que <strong>ALpanel</strong> detecte automáticamente cualquier proyecto, mida su
        consumo de CPU/RAM, extraiga las credenciales de su Base de Datos y ejecute
        <strong>Git Pull (con Rollback por conflictos)</strong>, <strong>Rebuild</strong> y
        <strong>Limpieza de Caché</strong> sin chocar puertos, sigue estas 3 reglas simples:
      </p>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-4">
          <div class="text-indigo-400 font-bold mb-1">1. Estructura en /opt</div>
          <p class="text-slate-400">
            El panel principal vive en <code class="text-slate-200">/opt/alpanel</code> y cada
            proyecto alojado vive en
            <code class="text-slate-200">/opt/projects/&lt;nombre_proyecto&gt;</code> con su propio
            <code class="text-slate-200">docker-compose.yml</code> y
            <code class="text-slate-200">.env</code>.
          </p>
        </div>
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-4">
          <div class="text-emerald-400 font-bold mb-1">2. Frontend y Backend independientes</div>
          <p class="text-slate-400">
            Dentro del <code class="text-slate-200">docker-compose.yml</code> defines los servicios
            <code class="text-slate-200">frontend</code>,
            <code class="text-slate-200">backend</code> y <code class="text-slate-200">db</code>.
            Así el panel te permite reiniciar o ver logs del Front o del Back por separado.
          </p>
        </div>
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-4">
          <div class="text-amber-400 font-bold mb-1">3. Variables DB estándar en .env</div>
          <p class="text-slate-200">
            Usa <code class="text-amber-300">DB_NAME</code>,
            <code class="text-amber-300">DB_USER</code>,
            <code class="text-amber-300">DB_PASSWORD</code> (o
            <code class="text-amber-300">MYSQL_*</code> /
            <code class="text-amber-300">POSTGRES_*</code>) en tu
            <code class="text-slate-200">.env</code> para que el botón
            <strong>Base de Datos</strong> del panel te muestre las credenciales automáticamente.
          </p>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div class="flex justify-between items-center mb-2">
          <span class="text-sm font-bold text-white">
            <i class="fa-solid fa-code-branch text-indigo-400 mr-2"></i>Plantilla 1: Proyecto con
            Frontend + Backend + DB separados
          </span>
          <button
            @click="copyText(fullstackYaml, 'Plantilla copiada')"
            class="text-xs text-indigo-400 hover:underline"
          >
            Copiar YAML
          </button>
        </div>
        <p class="text-xs text-slate-400 mb-3">
          Ideal para React/Next/Vue + Backend en Node, Java (Spring Boot), Python o Laravel:
        </p>
        <pre
          class="bg-slate-950 border border-slate-800 rounded-xl p-4 text-[11px] text-slate-200 font-mono overflow-x-auto"
        >{{ fullstackYaml }}</pre>
      </div>

      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div class="flex justify-between items-center mb-2">
          <span class="text-sm font-bold text-white">
            <i class="fa-solid fa-cubes text-emerald-400 mr-2"></i>Plantilla 2: Dockerfiles rápidos
            (Java / Node / Laravel)
          </span>
          <button
            @click="copyText(dockerfilesExamples, 'Dockerfiles copiados')"
            class="text-xs text-indigo-400 hover:underline"
          >
            Copiar
          </button>
        </div>
        <p class="text-xs text-slate-400 mb-3">
          Ejemplos listos para colocar dentro de <code class="text-slate-300">./backend/Dockerfile</code>:
        </p>
        <pre
          class="bg-slate-950 border border-slate-800 rounded-xl p-4 text-[11px] text-slate-200 font-mono overflow-x-auto"
        >{{ dockerfilesExamples }}</pre>
      </div>
    </div>
  </section>
</template>
