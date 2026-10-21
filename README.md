# ⚡ ALpanel — Orquestador Ligero de Proyectos, Docker & Bases de Datos para VPS

**ALpanel** es un panel de control autoalojado (self-hosted), ultraligero y escalable para servidores Linux VPS. Está diseñado para administrar múltiples proyectos en cualquier lenguaje (**Node.js, Python/Django, Java/Spring Boot, PHP/Laravel/Symfony, React/Vue/Next.js**) basados en `docker compose`, sin opciones de relleno y con control total en 1 clic.

![Node.js 20](https://img.shields.io/badge/Node.js-20_Alpine-339933?logo=nodedotjs&logoColor=white)
![Vue 3](https://img.shields.io/badge/Vue_3-Composition_API_%2B_TS-4FC08D?logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-Realtime_WebSockets-000000?logo=fastify&logoColor=white)
![DDoS Shield](https://img.shields.io/badge/DDoS_Shield-Token_Bucket_%3C1ms_RAM-F59E0B)
![Batch Ingest](https://img.shields.io/badge/Log_Ingest-Ring_Buffer_%2B_Backpressure-06B6D4)
![Docker Compose](https://img.shields.io/badge/Docker-Multi--Container-2496ED?logo=docker&logoColor=white)
![Architecture](https://img.shields.io/badge/Architecture-Hexagonal_(Ports_%26_Adapters)-8A2BE2)
![Unit Tests](https://img.shields.io/badge/Tests-36_Passing_(Jest_%2B_ts--jest)-C21325?logo=jest&logoColor=white)

---

## 🚀 ¿Qué hace único a ALpanel?

A diferencia de paneles pesados que consumen más de 1 GB de RAM o paneles limitados que solo permiten levantar un contenedor suelto por aplicación:

1. **⚡ Motor de Rate-Limiting Dinámico por CPU & Mitigación de DDoS (`< 1ms` en Memoria Volátil):**
   - Middleware nativo de ultra-baja latencia (`~0.02 ms` por decisión, complejidad `O(1)` en memoria RAM y **0 I/O de disco**) basado en el algoritmo **Token Bucket**.
   - **Auto-escalado dinámico según la CPU real del VPS:** Si la carga del servidor supera el `70%`, reduce automáticamente la capacidad global de tráfico al `60%`; si supera el `80%`, activa el **Escudo Crítico DDoS** reduciendo los tokens permitidos al `25%` y bloqueando IPs atacantes en memoria volátil.
   - Incluye un **Laboratorio Stress-Test DDoS interactivo** en la pestaña *Seguridad & Auditoría* para simular ráfagas de miles de peticiones y auditar la mitigación en vivo.
2. **🌊 Motor de Ingesta Masiva de Logs & Agregación por Lotes (*Batching Ring Buffer* + *Backpressure*):**
   - En lugar de ejecutar un `INSERT` SQL por cada evento de auditoría o telemetría (lo que colapsaría el disco duro ante ráfagas masivas), acumula los eventos en un **Ring Buffer en memoria RAM** (hasta `25,000` eventos) y los vuelca en lotes mediante `prisma.auditLog.createMany` cada **500 registros** o cada **2 segundos**, ahorrando más del **99% de operaciones IOPS** en MariaDB.
   - Implementa **Contrapresión automática (*Backpressure HTTP 429*)** si el buffer supera el umbral crítico o si la base de datos presenta latencia elevada, más un **Simulador Benchmark JSON Burst** integrado en la UI.
3. **Soporte Nativo Multicontenedor (`Frontend` + `Backend` + `Database`):**
   - Cada proyecto puede tener sus propios contenedores independientes (`frontend`, `backend`, `db`, `proxy`) dentro de su carpeta y su `docker-compose.yml`.
   - Permite reiniciar, reconstruir o ver logs **solo del Frontend** o **solo del Backend** sin tocar la base de datos.
4. **🔄 Ciclo de Despliegue Seguro para Bases de Datos en Producción (4 Niveles Desacoplados):**
   - **`Git Pull` (Solo Código + Rollback ante Conflictos):** Descarga exclusivamente los commits desde `origin/main` (o `master`) sin reiniciar ni destruir ningún contenedor Docker. Si detecta conflictos de fusión, ejecuta `git reset --hard <commit_previo>` automáticamente.
   - **`Restart Docker`:** Reinicia contenedores en caliente aplicando los últimos cambios sin tocar volúmenes.
   - **`Rebuild` (Seguro — Preserva Datos SQL):** Reconstruye las imágenes Docker (`docker compose up -d --build`) manteniendo intactos los volúmenes y datos de la base de datos.
   - **`Rebuild Destroy` (Último Recurso — Recreación Total desde Cero):** Protegido con modal de confirmación explícita (`¿Seguro que quieres ejecutar Rebuild Destroy?`), destruye contenedores, volúmenes (`-v`) e imágenes locales, levanta todo desde cero y ejecuta las migraciones iniciales limpias.
5. **Monitoreo en Tiempo Real (WebSockets):**
   - Barra superior con métricas reales del VPS (**CPU %**, **RAM usada/total**, **Disco SSD** y **Uptime**).
   - Medición exacta de **CPU (%)**, **RAM (MB)** y **Disco (MB)** por cada proyecto y desglosado por cada contenedor individual.
6. **🗄️ Inspector y Backup de Base de Datos en 1 Clic:**
   - El botón **Base de Datos** detecta automáticamente el motor (`MySQL`, `MariaDB`, `PostgreSQL`) y te entrega listos para copiar en **DBeaver, TablePlus o Navicat**:
     - **Host / IP Pública del VPS** y **Host Interno Docker**
     - **Puerto Externo** mapeado y **Puerto Interno**
     - **Nombre de la Base de Datos (`Database`)**, **Usuario (`Username`)**, **Contraseña (`Password`)** y credenciales **`root` / `postgres`**
     - **URL de conexión directa** (`mysql://...` / `postgresql://...`) y **Comando de Terminal**
     - **Botón `Descargar Backup .SQL`** que ejecuta `mysqldump` / `pg_dump` en caliente y descarga el archivo `.sql` a tu navegador.
7. **🧹 Limpieza Inteligente de Caché (Por Proyecto y Global) + Enrutador SSL (Caddy):**
   - **Por Proyecto:** Limpia archivos de caché según el stack detectado (`__pycache__`/`.pyc` en Python/Django, `php artisan optimize:clear` en Laravel, `php symfony cc` en Symfony).
   - **Global del Servidor (`Docker Prune`):** Libera gigas de disco eliminando imágenes huérfanas y caché de compilación de Docker.
   - **Dominios & SSL + Editor `.env`:** Configura dominios HTTPS automáticos con Caddy y edita variables `.env` (con permisos `0600`) desde el navegador.

---

## 📦 Instalación en cualquier VPS (Ubuntu / Debian)

### 1. Requisitos previos y estructura en `/opt`
Instala **Git**, **Docker** y **Docker Compose v2**, y crea los directorios estándar en `/opt`:
- `/opt/alpanel`: Repositorio y servicios propios de **ALpanel** (`alpanel_server`, `alpanel_db`, `alpanel_caddy`).
- `/opt/projects`: Carpeta donde vivirán todos tus proyectos alojados (ej. `/opt/projects/mi_proyecto`).

```bash
sudo apt-get update && sudo apt-get install -y git curl docker.io docker-compose-v2
sudo usermod -aG docker $USER

# Crear directorios estándar en /opt y asignar permisos a tu usuario
sudo mkdir -p /opt/alpanel /opt/projects
sudo chown -R $USER:$USER /opt/alpanel /opt/projects
```

### 2. Clonar y configurar `ALpanel`
```bash
git clone https://github.com/alexmargomez/ALpanel.git /opt/alpanel
cd /opt/alpanel
cp .env.example .env
```

Edita el archivo `.env` con tus propias credenciales seguras:
```ini
PANEL_PORT=9000
PANEL_USER=superadmin
PANEL_PASSWORD=TuPasswordSuperSeguroAqui
PANEL_JWT_SECRET=GeneraUnSecretoAleatorioLargoAqui
DB_HOST=panel_db
PANEL_SELF_PATH=/opt/alpanel
HOST_PROJECTS_PATH=/opt/projects
PROJECTS_ROOT=/opt/projects
```

### 3. Levantar el panel
```bash
docker compose up -d --build
```
Ingresa desde tu navegador a: **`http://TU_IP_DEL_SERVIDOR:9000`** (o a tu dominio SSL configurado en la pestaña **Dominios & SSL**).

---

## 📐 Cómo estructurar tus proyectos y variables `.env` para ALpanel

ALpanel escanea automáticamente todas las carpetas dentro de `PROJECTS_ROOT` (`/opt/projects`) **y además incluye siempre su propio directorio `PANEL_SELF_PATH` (`/opt/alpanel`)** como tarjeta protegida (`🛡️ Panel Principal`).

Además, **ALpanel sincroniza automáticamente los puertos y el dominio en el archivo `.env` de cada proyecto** cuando guardas una regla en **Dominios & SSL** o cuando inicias/reinicias el proyecto, evitando choques de puertos entre múltiples aplicaciones alojadas en el mismo VPS.

---

### 🔌 Convención de Variables de Puerto y Dominio en `.env` (Sincronización Automática)

Para que ALpanel modifique automáticamente los puertos de tu `.env` desde **Dominios & SSL** y auto-asigne el puerto de Base de Datos según disponibilidad en el servidor, utiliza estos nombres estándar en tu `.env.example` / `.env` y en tu `docker-compose.yml`:

#### Opción A — Proyecto de **2 Variables de Puerto** (Monolito / API + Base de Datos)
Si tu proyecto tiene un único contenedor de aplicación + un contenedor de Base de Datos:

| Variable en `.env` | Función en ALpanel |
| :--- | :--- |
| **`PORT`** *(o `BACKEND_PORT`)* | **Puerto de la Aplicación.** Se modifica automáticamente en el `.env` con el puerto que coloques en **Dominios & SSL** (ej. si colocas `miapp_server:3000`, ALpanel escribe `PORT=3000` en `.env`). |
| **`DB_EXTERNAL_PORT`** *(o `POSTGRES_PORT`)* | **Puerto Externo de Base de Datos.** ALpanel verifica qué puertos están ocupados en el VPS y **modifica automáticamente tu `.env`** con el primer puerto libre disponible (`3307`, `3309`, `3310`... en MariaDB o `5432`, `5433`... en PostgreSQL). |

#### Opción B — Proyecto de **3 Variables de Puerto** (`Frontend` + `Backend` + `Base de Datos` separados)
Si tu proyecto desacopla el Frontend (Vue/React/Vite) y el Backend (Django/Laravel/Node/Spring) en contenedores separados:

| Variable en `.env` | Función en ALpanel |
| :--- | :--- |
| **`FRONTEND_PORT`** | **Puerto del Frontend.** Se modifica automáticamente en el `.env` con el puerto que coloques en **Frontend Target** dentro de **Dominios & SSL** (ej. `miapp_frontend:5174` $\rightarrow$ `FRONTEND_PORT=5174`). |
| **`BACKEND_PORT`** | **Puerto del Backend (API).** Se modifica automáticamente en el `.env` con el puerto que coloques en **Backend Target (`/api/*`)** dentro de **Dominios & SSL** (ej. `miapp_backend:8000` $\rightarrow$ `BACKEND_PORT=8000` y actualiza `VITE_BACKEND_PROXY=http://backend:8000`). |
| **`DB_EXTERNAL_PORT`** *(o `POSTGRES_PORT`)* | **Puerto Externo de Base de Datos.** Se auto-asigna y escribe automáticamente en `.env` según disponibilidad en el servidor para que nunca choque con otros proyectos. |

#### 🌐 Variables de Dominio en `.env` (Cero dominios quemados en GitHub)
En tu repositorio de GitHub/GitLab **nunca debes quemar tu dominio real** en `docker-compose.yml` ni en `.env.example` (deja únicamente `localhost`). Si tu `.env` incluye cualquiera de las siguientes variables, **ALpanel inyectará automáticamente el dominio real** cuando lo configures en la pestaña **Dominios & SSL**:

- **`APP_DOMAIN`** o **`CADDY_DOMAIN`** $\rightarrow$ ALpanel escribe `tu-dominio.com`.
- **`APP_URL`** *(Laravel / Node)* $\rightarrow$ ALpanel escribe `https://tu-dominio.com`.
- **`ALLOWED_HOSTS`** *(Django)* $\rightarrow$ ALpanel conserva `localhost,127.0.0.1,backend` y agrega automáticamente `,tu-dominio.com`.
- **`CSRF_TRUSTED_ORIGINS`** *(Django)* $\rightarrow$ ALpanel conserva `http://localhost,https://localhost` y agrega automáticamente `,http://tu-dominio.com,https://tu-dominio.com`.

#### 🗄️ Variables de Credenciales de Base de Datos (Auto-detectadas por el Inspector SQL)
- **MariaDB:** `MARIADB_DATABASE`, `MARIADB_USER`, `MARIADB_PASSWORD`, `MARIADB_ROOT_PASSWORD` *(también soporta `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`, `DB_USERNAME`)*.
- **PostgreSQL:** `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`.

---

### Ejemplo de `.env.example` y `docker-compose.yml` (3 Variables: Frontend + Backend + MariaDB 11)

**`.env.example` (seguro para subir a GitHub):**
```ini
# 1. Puertos (Sincronizados y auto-asignados por ALpanel)
FRONTEND_PORT=5173
BACKEND_PORT=8000
DB_EXTERNAL_PORT=3307

# 2. Dominio y Seguridad (ALpanel inyecta el dominio real al asignarlo en Dominios & SSL)
APP_DOMAIN=localhost
APP_URL=http://localhost:8000
ALLOWED_HOSTS=localhost,127.0.0.1,backend
CSRF_TRUSTED_ORIGINS=http://localhost,https://localhost,http://localhost:5173

# 3. Base de Datos (MariaDB 11)
MARIADB_DATABASE=miapp_db
MARIADB_USER=miapp_user
MARIADB_PASSWORD=miapp_password
MARIADB_ROOT_PASSWORD=miapp_root_password

DB_HOST=db
DB_PORT=3306
VITE_API_URL=/api
VITE_BACKEND_PROXY=http://backend:8000
```

**`docker-compose.yml`:**
```yaml
services:
  db:
    image: mariadb:11
    container_name: miapp_mariadb
    restart: unless-stopped
    env_file:
      - .env
    environment:
      MARIADB_DATABASE: "${MARIADB_DATABASE:-miapp_db}"
      MARIADB_USER: "${MARIADB_USER:-miapp_user}"
      MARIADB_PASSWORD: "${MARIADB_PASSWORD:-miapp_password}"
      MARIADB_ROOT_PASSWORD: "${MARIADB_ROOT_PASSWORD:-miapp_root_password}"
    ports:
      - "${DB_EXTERNAL_PORT:-3307}:3306"
    volumes:
      - mariadb_data:/var/lib/mysql

  backend:
    build: ./backend
    container_name: miapp_backend
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "${BACKEND_PORT:-8000}:${BACKEND_PORT:-8000}"
    depends_on:
      - db

  frontend:
    build: ./frontend
    container_name: miapp_frontend
    restart: unless-stopped
    environment:
      FRONTEND_PORT: "${FRONTEND_PORT:-5173}"
      BACKEND_PORT: "${BACKEND_PORT:-8000}"
      VITE_API_URL: "${VITE_API_URL:-/api}"
      VITE_BACKEND_PROXY: "${VITE_BACKEND_PROXY:-http://backend:${BACKEND_PORT:-8000}}"
    ports:
      - "${FRONTEND_PORT:-5173}:${FRONTEND_PORT:-5173}"
    depends_on:
      - backend

volumes:
  mariadb_data:
```

---

## ⚡ Motores de Alto Rendimiento: Mitigación DDoS Dinámica & Ingesta Masiva (Batching + Backpressure)

Dentro de la pestaña **Seguridad & Auditoría**, ALpanel incorpora dos motores de ingeniería de alto rendimiento diseñados para proteger el servidor en tiempo real sin degradar la latencia ni saturar los discos SSD/NVMe:

### 1. 🛡️ Motor de Rate-Limiting Dinámico por CPU & Mitigación de DDoS (`< 1ms` en Memoria Volátil)
- **Algoritmo Token Bucket Atómico en RAM (`O(1)`):**
  - Intercepta cada petición entrante en el hook `onRequest` de Fastify midiendo el tiempo de decisión con reloj de alta resolución en nanosegundos (`process.hrtime.bigint()`).
  - Tiempo medio de respuesta por decisión: **`~0.01 ms – 0.05 ms`** (muy por debajo del presupuesto crítico de `< 2 ms`), **sin tocar el disco duro** ni realizar consultas SQL durante el filtrado.
- **Límite Dinámico Consciente de la CPU del Servidor (*CPU-Aware Throttling*):**
  - El motor se alimenta en vivo de la telemetría real del VPS (`HostService`) y ajusta automáticamente la capacidad y tasa de recarga global de los buckets:
    - **Modo `NORMAL` (CPU `< 70%`):** Factor `1.0x` (100% de la capacidad base configurada).
    - **Modo `THROTTLING_CPU_HIGH` (CPU `70% – 79%`):** Factor `0.6x` (reduce preventivamente el tráfico permitido al 60%).
    - **Modo `CRITICAL_DDOS_SHIELD` (CPU `≥ 80%`):** Factor `0.25x` (reduce drásticamente el límite al 25% y duplica la penalización de *strikes* para contener ataques volumétricos).
- **Bloqueo Volátil de IPs y Cabeceras Estándar:**
  - Las IPs que agotan repetidamente su *Token Bucket* acumulan *strikes* y pasan a un mapa de bloqueo en memoria volátil (`IP_BLOCKED_MEMORY`) con expiración automática TTL y botón de **Desbloqueo en 1 clic** desde la interfaz.
  - Inyecta cabeceras de telemetría en tiempo real: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Mode` y `X-Shield-Latency-Ms`.
- **Laboratorio Stress-Test DDoS Integrado:**
  - Permite disparar ráfagas controladas (`150` a `2,500` peticiones) simulando distintos escenarios de carga de CPU (`CPU Real`, `75% Alerta`, `88% Crítica`) para verificar la reducción dinámica de tokens y la velocidad de bloqueo en memoria.

### 2. 🌊 Motor de Ingesta Masiva y Agregación de Logs/Métricas (*Batching Ring Buffer* + *Backpressure*)
- **Arquitectura de Escritura Diferida por Lotes (*Batching*):**
  - Escribir miles de eventos por segundo fila por fila (`INSERT` individual) colapsa cualquier base de datos relacional. El repositorio [`PrismaAuditLogRepository`](src/modules/security/infrastructure/repositories/prisma-audit-log.repository.ts) desacopla la recepción HTTP de la persistencia en disco mediante un **Buffer en Memoria (`writeBuffer`, capacidad `25,000` eventos)**.
  - Los eventos se encolan en RAM en **`< 0.02 ms`** y un *worker* asíncrono los persiste en bloque usando `prisma.auditLog.createMany` cada **500 registros** o cada **2,000 ms**, reduciendo 500 escrituras de disco a **1 sola transacción SQL** (>99% de ahorro en IOPS).
- **Mecanismo de Contrapresión (*Backpressure HTTP 429*):**
  - Monitorea continuamente la ocupación del buffer y la latencia del último *flush* en MariaDB:
    - `HEALTHY`: Ocupación `< 70%` y latencia de base de datos óptima.
    - `ELEVATED`: Ocupación `> 70%` o *flush* lento (`> 600 ms`).
    - `BACKPRESSURE_429`: Si el buffer supera el `90%` de capacidad o la base de datos se ralentiza críticamente, el motor activa contrapresión devolviendo `HTTP 429 Too Many Requests` para proteger la memoria del proceso Node.js y evitar tumbar el servidor principal.
- **Benchmark Interactivo de Ingesta JSON:**
  - Incluye botones en vivo (`+300 Eventos en RAM`, `+1,500 Batch Flush`, `+5,000 Stress Benchmark` y `Forzar Flush a MariaDB Ahora`) que miden el *throughput* real en **eventos/segundo** y el contador acumulado de **IOPS / Queries SQL ahorradas**.

### 3. 🔒 Blindaje Adicional de Infraestructura
- **Cero Credenciales en el Código:** Ninguna contraseña real, IP ni dominio se almacena en el repositorio; todo se lee desde `.env` (ignorado por Git).
- **Sanitización contra Path Traversal e Inyección (`ProjectNameVO` / `DomainNameVO`):** Todos los nombres de proyectos, contenedores, ramas y dominios se validan estrictamente y se confinan dentro de `PROJECTS_ROOT`.
- **Permisos `.env` Restringidos (`0600`):** Al crear o editar variables de entorno desde el panel, el archivo se protege con permisos `0600`.

---

## 🔐 Arquitectura de Permisos por Rol, Módulos y Servicios (Estilo GitHub Classic Token)

En **ALpanel**, los permisos se asignan **por Rol** (nunca por usuario individual; cada usuario hereda los permisos de su Rol asignado, y un proyecto puede sobreescribir el Rol de un usuario específico mediante `ProjectMember`).

La interfaz de **Roles & Permisos** funciona igual que los **Personal Access Tokens (Classic) de GitHub**:
1. **Nivel 1 — Módulo Padre (`src/modules/<modulo>`):** Controla si el Rol tiene acceso a la vista/módulo principal.
2. **Nivel 2 — Sub-Servicios del Módulo (`src/services/<modulo>/*.service.ts`):** Permite habilitar el módulo padre para un Rol pero **restringir qué servicios específicos puede usar dentro de ese módulo** (por ejemplo, permitir ver logs y reiniciar contenedores en `projects`, pero prohibir detener contenedores, editar `.env` o descargar backups SQL).
3. **Regla de Módulo sin Servicios (Permiso de Módulo Completo):** Si un módulo en `src/modules/<modulo>` **NO tiene carpeta o servicios** dentro de `src/services/<modulo>/` (como ocurre con `security` / Auditoría), el permiso aplica automáticamente al **módulo completo**.
4. **Servicios Independientes (`src/services/*.service.ts`):** Los servicios que no pertenecen a un módulo específico se colocan directamente en la raíz de `src/services/` (ej. `src/services/docker-prune.service.ts` $\rightarrow$ `services.docker_prune`) y aparecen agrupados en una sección aparte llamada **Servicios Independientes**.

### Estructura de Carpetas: Backend (`src/`) y Frontend (`frontend/`)

```text
ServerPanel/
├── frontend/                                # 🎨 FRONTEND (Vue 3 <script setup lang="ts"> + TypeScript + Vite)
│   └── src/
│       ├── main.ts                          # Punto de entrada de la SPA Vue 3
│       ├── App.vue                          # Layout raíz, sesión JWT y orquestación de pestañas/modales
│       ├── types/
│       │   └── panel.ts                     # Interfaces TypeScript compartidas con el Backend
│       ├── services/
│       │   └── api.ts                       # Helpers de formato, criptografía .env y catálogo base
│       ├── composables/
│       │   ├── usePanelStore.ts             # Store reactivo centralizado y guardas RBAC (hasPerm)
│       │   └── useSocket.ts                 # Telemetría WebSocket en tiempo real (Socket.IO)
│       ├── views/                           # Vistas principales de los 6 módulos
│       │   ├── ProjectsView.vue             # Gestión multicontenedor, Git Pull puro, Rebuild y Rebuild Destroy
│       │   ├── DomainsView.vue
│       │   ├── GitGuideView.vue
│       │   ├── UsersRolesView.vue
│       │   ├── PermissionsView.vue
│       │   └── SecurityAuditView.vue        # Dashboard DDoS Token Bucket + Batch Ingest Engine + Auditoría
│       └── components/
│           ├── common/
│           │   └── PermissionMatrixSelector.vue
│           ├── layout/
│           │   ├── LoginView.vue
│           │   ├── TopHeader.vue
│           │   └── ToastNotification.vue
│           └── modals/                      # Los 7 modales reactivos del sistema
│               ├── DbCredentialsModal.vue
│               ├── ConsoleLogsModal.vue
│               ├── EnvEditorModal.vue
│               ├── CloneProjectModal.vue
│               ├── UserModal.vue
│               ├── RoleModal.vue
│               └── AppUsersModal.vue
│
├── src/                                     # ⚙️ BACKEND HEXAGONAL (Puertos y Adaptadores — Fastify + TS + Prisma + Dockerode)
│   ├── config/
│   │   └── permissions.ignore.json          # Módulos y archivos de servicios ignorados en RBAC (habilitados para todos)
│   ├── shared/                              # 🏛️ NÚCLEO COMPARTIDO (Cross-Cutting Concerns)
│   │   ├── domain/
│   │   │   └── exceptions/domain.exception.ts # Excepción base tipada con statusCode HTTP
│   │   └── infrastructure/
│   │       ├── database/prisma.service.ts   # Cliente Prisma Singleton
│   │       ├── http/
│   │       │   ├── middlewares/auth.middleware.ts # Guardias JWT y RBAC en memoria
│   │       │   └── routes/api.routes.ts     # Enrutador maestro de módulos
│   │       └── services/
│   │           ├── crypto.service.ts        # Hashing scrypt y comparación timingSafeEqual
│   │           ├── host-metrics.service.ts  # Telemetría de CPU/RAM/Disco/Red del VPS
│   │           └── service-registry.ts      # Auto-descubrimiento RBAC
│   ├── modules/                             # ⬢ MÓDULOS HEXAGONALES (Domain / Application / Infrastructure)
│   │   ├── projects/                        # Módulo Padre: Proyectos & Contenedores
│   │   │   ├── domain/                      # Entidades, Value Objects (ProjectNameVO) y Excepciones
│   │   │   ├── application/                 # Puertos (ContainerRuntimePort, GitRepositoryPort) y Casos de Uso
│   │   │   └── infrastructure/              # Adaptadores (Dockerode, Git CLI, Filesystem), Controlador y Rutas
│   │   ├── domains/                         # Módulo Padre: Dominios & SSL (DomainNameVO, ReverseProxyPort, CaddyAdapter)
│   │   ├── users/                           # Módulo Padre: Usuarios (UsernameVO, UserRepositoryPort, PrismaUserRepository)
│   │   ├── roles/                           # Administración de Roles (RoleRepositoryPort, protección SuperAdmin)
│   │   ├── permissions/                     # Matriz RBAC granular (PermissionRepositoryPort, caché en memoria)
│   │   ├── security/                        # Escudo DDoS Token Bucket (<1ms RAM) + Ring Buffer Batch Ingest + Auditoría
│   │   ├── auth/                            # Autenticación JWT (LoginUserUseCase, GetUserProfileUseCase)
│   │   ├── git/                             # Cuentas Git y Clonación de Repositorios
│   │   └── dashboard/                       # Resumen de Métricas del Servidor
│   └── services/                            # Servicios granulares auto-descubiertos para el árbol RBAC
│       ├── service-registry.ts              # Escáner automático de módulos y servicios
│       ├── crypto.service.ts                # (Ignorado en permissions.ignore.json — uso interno global)
│       ├── host.service.ts                  # (Ignorado en permissions.ignore.json — uso interno global)
│       ├── docker-prune.service.ts          # ⚡ Servicio Independiente -> código: services.docker_prune
│       ├── projects/                        # 📦 Sub-servicios del módulo "projects"
│       │   ├── container-logs.service.ts    # -> projects.logs (Ver Logs y Métricas)
│       │   ├── container-restart.service.ts # -> projects.restart_cache (Reiniciar y Limpiar Caché)
│       │   ├── container-power.service.ts   # -> projects.stop_rebuild (Detener, Rebuild Seguro y Rebuild Destroy)
│       │   ├── project-db.service.ts        # -> projects.db_view y projects.db_backup (Inspector y Backup SQL)
│       │   ├── project-env.service.ts       # -> projects.env_view y projects.env_edit (Variables .env)
│       │   ├── project-users.service.ts     # -> projects.app_users (Gestionar Usuarios Internos de cada App)
│       │   └── git-deploy.service.ts        # -> projects.git_pull (Git Pull con Rollback ante Conflictos)
│       ├── domains/                         # 🌐 Sub-servicios del módulo "domains"
│       │   └── caddy-ssl.service.ts         # -> domains.manage (Gestionar Dominios y SSL)
│       ├── git/                             # 🔑 Sub-servicios del módulo "git"
│       │   └── git-clone.service.ts         # -> git.clone (Cuentas Git y Clonar Proyectos)
│       └── users/                           # 👥 Sub-servicios del módulo "users"
│           └── users-roles.service.ts       # -> users.manage (Gestionar Usuarios y Roles)
│
├── tests/                                   # 🧪 PRUEBAS UNITARIAS CENTRALIZADAS (Jest + ts-jest)
│   ├── shared/
│   │   ├── domain.exception.spec.ts
│   │   ├── crypto.service.spec.ts
│   │   └── auth.middleware.spec.ts
│   └── modules/
│       ├── projects/
│       │   ├── project-name.vo.spec.ts
│       │   └── projects-use-cases.spec.ts
│       ├── domains/
│       │   └── manage-domains.use-case.spec.ts
│       ├── users/
│       │   └── manage-users.use-case.spec.ts
│       ├── roles/
│       │   └── manage-roles.use-case.spec.ts
│       ├── permissions/
│       │   └── manage-permissions.use-case.spec.ts
│       └── security/
│           └── manage-audit-logs.use-case.spec.ts
│
└── public/                                  # 📦 Activos estáticos servidos por Fastify (incluye /assets/app.js compilado por Vite)
```

---

## 🧪 Pruebas Unitarias Centralizadas (`tests/` + Jest)

Todas las pruebas unitarias están centralizadas en la carpeta raíz [`tests/`](tests/) y se ejecutan con **Jest (`jest` + `ts-jest`)**, manteniendo `src/` y `dist/` exclusivamente para código de producción.

Gracias a la **Arquitectura Hexagonal**, toda la lógica de negocio y los casos de uso se prueban de forma **100% aislada en memoria** sin requerir contenedores Docker activos ni base de datos MariaDB conectada:

```bash
# Ejecutar las 10 suites (36 tests unitarios)
npm test

# Ejecutar con reporte de cobertura de código
npm run test:cov
```

### Cobertura de las 10 Suites (36 Tests)
- **Dominio y Excepciones (`domain/`):**
  - `ProjectNameVO`: Sanitización de nombres, bloqueo de *Path Traversal* (`../etc/passwd`), inyección de comandos y resolución segura de rutas (`isSelfPanel`).
  - `UsernameVO` y `DomainNameVO`: Normalización y validación estricta de nombres de usuario y dominios/subdominios SSL.
  - `DomainException`: Verificación de códigos de estado HTTP (`400`, `401`, `403`, `404`) en todas las excepciones de dominio.
- **Casos de Uso con Puertos Mockeados en Memoria (`application/`):**
  - `security`: Pruebas de escalamiento dinámico del **Token Bucket** cuando la CPU supera el 80% (`0.25x`), bloqueo y desbloqueo de IPs atacantes en memoria volátil en `< 2ms`, e **Ingesta Masiva por Lotes** verificando el ahorro de operaciones SQL.
  - `projects`: `ListProjectsUseCase`, `ManageProjectEnvUseCase` (permisos `0600` y fallback `.env.example`), `ManageProjectDbUseCase` (extracción de credenciales MariaDB/PostgreSQL y armado de URLs/CLI), `ManageContainerPowerUseCase` (protección anti-apagado de ALpanel), aislamiento de variables Docker Compose y sincronización automática de puertos/dominios en `.env`.
  - `users`, `roles`, `permissions`, `domains`: Pruebas CRUD completas sobre *In-Memory Repository & Proxy Ports* y protección inmutable del rol `superadmin`.
- **Seguridad e Infraestructura Compartida (`shared/`):**
  - `CryptoService`: Hashing `scrypt` con salt aleatorio/fijo y verificación `timingSafeEqual`.
  - `auth.middleware`: Pruebas unitarias de `authenticate` (JWT) y `requirePermission` (RBAC y bypass de `superadmin`).

---

### ✨ Cómo agregar un Nuevo Módulo o Servicio (Auto-Descubrimiento)

El archivo [`src/services/service-registry.ts`](src/services/service-registry.ts) escanea automáticamente las carpetas `src/modules/` y `src/services/` al iniciar el servidor y sincroniza los códigos en la tabla `permissions` de MySQL/MariaDB. **No necesitas escribir migraciones SQL manuales para registrar permisos nuevos.**

#### Opción A: Crear un nuevo Sub-Servicio dentro de un Módulo existente
1. Crea un archivo `.service.ts` dentro de `src/services/<nombre_del_modulo>/` (por ejemplo: `src/services/projects/container-shell.service.ts`).
2. *(Opcional pero recomendado)* Agrega un bloque JSDoc al inicio del archivo para personalizar el código, nombre, descripción, ícono y roles por defecto que lo tendrán activo al crearse:
   ```ts
   /**
    * @serviceCode projects.shell
    * @serviceName Terminal Interactiva
    * @serviceDescription Permite abrir una consola bash/sh dentro del contenedor.
    * @serviceIcon 🐚
    * @defaultRoles SUPERADMIN,ADMIN
    */
   ```
   *(Si no agregas JSDoc, ALpanel generará automáticamente el código `projects.container_shell` a partir del nombre del archivo y de la carpeta).*
3. Protege la ruta en tu controlador usando el middleware `requireService('projects.shell')`:
   ```ts
   app.post('/api/projects/:name/shell', {
     preHandler: [app.authenticate, app.requireService('projects.shell')]
   }, handler);
   ```
4. Al reiniciar el panel, el nuevo sub-servicio aparecerá automáticamente debajo del módulo **Proyectos & Contenedores** en la vista **Roles & Permisos**.

#### Opción B: Crear un Servicio Independiente (que no pertenece a ningún módulo)
1. Crea tu archivo `.service.ts` directamente en la raíz de `src/services/` (por ejemplo: `src/services/server-reboot.service.ts`).
2. Añade opcionalmente la cabecera JSDoc (`@serviceCode services.server_reboot`, `@serviceName`, `@serviceDescription`, `@serviceIcon`, `@defaultRoles`).
3. El servicio aparecerá automáticamente en el bloque **⚡ Servicios Independientes** de la vista **Roles & Permisos**.

#### Opción C: Crear un Módulo Nuevo sin Sub-Servicios (Permiso de Módulo Completo)
1. Crea la carpeta del módulo en `src/modules/<nuevo_modulo>/` y **no crees** carpeta en `src/services/<nuevo_modulo>/`.
2. ALpanel detectará que el módulo no tiene sub-servicios divididos y mostrará un único switch de **Módulo Completo (`✔` / `✖`)** en **Roles & Permisos**.

---

### 🙈 Cómo ignorar Módulos o Archivos de Servicios (`src/config/permissions.ignore.json`)

Si creas un módulo base o un archivo `.service.ts` de utilidad interna (como cifrado, métricas del host o autenticación) que **NO debe aparecer en la vista de permisos** porque debe estar **habilitado siempre para todos los usuarios**, agrégalo en [`src/config/permissions.ignore.json`](src/config/permissions.ignore.json):

```json
{
  "$comment": "Módulos y archivos de servicios ignorados en la vista de Roles y Permisos. Todo lo listado aquí está habilitado por defecto para todos los usuarios autenticados.",
  "ignoredModules": [
    "auth",
    "dashboard",
    "roles",
    "permissions"
  ],
  "ignoredServices": [
    "service-registry.ts",
    "crypto.service.ts",
    "host.service.ts"
  ]
}
```

- Cualquier carpeta listada en `ignoredModules` o archivo listado en `ignoredServices` (admite tanto el nombre del archivo `"mi-helper.service.ts"` como rutas relativas `"projects/helper-interno.service.ts"`) será excluido automáticamente del árbol de **Roles & Permisos** y estará permitido para todos los roles sin restricción.

