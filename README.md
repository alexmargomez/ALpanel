# ⚡ ALpanel — Orquestador Ligero de Proyectos, Docker & Bases de Datos para VPS

**ALpanel** es un panel de control autoalojado (self-hosted), ultraligero y escalable para servidores Linux VPS. Está diseñado para administrar múltiples proyectos en cualquier lenguaje (**Node.js, Python/Django, Java/Spring Boot, PHP/Laravel/Symfony, React/Vue/Next.js**) basados en `docker compose`, sin opciones de relleno y con control total en 1 clic.

![Node.js 20](https://img.shields.gl/badge/Node.js-20_Alpine-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-Realtime_WebSockets-000000?logo=fastify&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker-Multi--Container-2496ED?logo=docker&logoColor=white)

---

## 🚀 ¿Qué hace único a ALpanel?

A diferencia de paneles pesados que consumen más de 1 GB de RAM o paneles limitados que solo permiten levantar un contenedor suelto por aplicación:

1. **Soporte Nativo Multicontenedor (`Frontend` + `Backend` + `Database`):**
   - Cada proyecto puede tener sus propios contenedores independientes (`frontend`, `backend`, `db`, `proxy`) dentro de su carpeta y su `docker-compose.yml`.
   - Permite reiniciar o ver logs **solo del Frontend** o **solo del Backend** sin tocar la base de datos.
2. **Monitoreo en Tiempo Real (WebSockets):**
   - Barra superior con métricas reales del VPS (**CPU %**, **RAM usada/total**, **Disco SSD** y **Uptime**).
   - Medición exacta de **CPU (%)**, **RAM (MB)** y **Disco (MB)** por cada proyecto y desglosado por cada contenedor individual.
3. ** Despliegue en 1 Clic (`Git Pull & Restart`) con Rollback Automático:**
   - Botón **Verificar remoto** que te avisa con una insignia (`⬆️ X commit(s) por bajar`) si hay cambios nuevos en GitHub/GitLab.
   - Al ejecutar **Git Pull & Restart**, guarda el commit estable actual (`HEAD`); si el despliegue falla, revierte automáticamente a la versión anterior funcional.
4. **🗄️ Inspector y Backup de Base de Datos en 1 Clic:**
   - El botón **Base de Datos** detecta automáticamente el motor (`MySQL`, `MariaDB`, `PostgreSQL`) y te entrega listos para copiar en **DBeaver, TablePlus o Navicat**:
     - **Host / IP Pública del VPS** y **Host Interno Docker**
     - **Puerto Externo** mapeado y **Puerto Interno**
     - **Nombre de la Base de Datos (`Database`)**
     - **Usuario (`Username`)** y **Contraseña (`Password`)** (con vista oculta y copiado rápido)
     - **Usuario `root` / `postgres`** y su contraseña
     - **URL de conexión directa** (`mysql://...` / `postgresql://...`) y **Comando de Terminal**
     - **Botón `Descargar Backup .SQL`** que ejecuta `mysqldump` / `pg_dump` en caliente y descarga el archivo `.sql` a tu navegador.
5. **🧹 Limpieza Inteligente de Caché (Por Proyecto y Global):**
   - **Por Proyecto:** Limpia archivos de caché según el stack detectado (`__pycache__`/`.pyc` en Python/Django, `php artisan optimize:clear` en Laravel, `php symfony cc` en Symfony) y recarga los contenedores.
   - **Global del Servidor (`Docker Prune`):** Libera gigas de disco eliminando imágenes huérfanas y caché de compilación de Docker.
6. **🌐 Enrutador de Dominios SSL (Caddy) y Editor `.env`:**
   - Edita las variables `.env` de cualquier proyecto desde el navegador (guardadas con permisos seguros `0600`) y reinicia el stack en 1 clic.
   - Configura dominios y subdominios con HTTPS automático (Let's Encrypt), permitiendo enrutar `/` hacia el contenedor Frontend y `/api/*` hacia el contenedor Backend.

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

## 📐 Cómo estructurar tus proyectos para que ALpanel los administre

ALpanel escanea automáticamente todas las carpetas dentro de `PROJECTS_ROOT` (`/opt/projects`) **y además incluye siempre su propio directorio `PANEL_SELF_PATH` (`/opt/alpanel`)** como tarjeta protegida (`🛡️ Panel Principal`) para que puedas ejecutar `Git Pull & Restart`, `Restart Docker`, `Limpiar Caché`, `Base de Datos`, `.env` y `Modo Desarrollador` del propio panel desde la interfaz web.

Para que cualquier proyecto alojado sea detectado con todas sus funciones:

1. **Ubica cada proyecto en su propia carpeta dentro de `/opt/projects`:** ej. `/opt/projects/mi_proyecto` (o clónalo en 1 clic desde el botón **`+ Nuevo Proyecto (Git)`** del panel).
2. **Incluye un `docker-compose.yml` y un `.env`:**
   - Para que el botón **Base de Datos** detecte las credenciales automáticamente, usa nombres de variables estándar en tu `.env`:
     - `MYSQL_DATABASE` / `POSTGRES_DB` / `DB_NAME`
     - `MYSQL_USER` / `POSTGRES_USER` / `DB_USER`
     - `MYSQL_PASSWORD` / `POSTGRES_PASSWORD` / `DB_PASSWORD`
     - `MYSQL_ROOT_PASSWORD`
   - Si quieres conectarte a la base de datos desde un cliente externo (DBeaver/TablePlus), mapea un puerto único en el servicio `db` de tu `docker-compose.yml` (ej. `"3307:3306"` en el Proyecto 1, `"3309:3306"` en el Proyecto 2).

### Ejemplo de `docker-compose.yml` con Frontend + Backend + MariaDB 11 independientes
```yaml
services:
  db:
    image: mariadb:11
    container_name: miapp_db
    restart: unless-stopped
    env_file: .env
    ports:
      - "3307:3306"
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
  db_data:
```

---

## 🛡️ Seguridad y Prevención de Fallos Incorporada

- **Cero Credenciales en el Código:** Ninguna contraseña real, IP ni dominio se almacena en el repositorio; todo se lee desde `.env` (ignorado por Git).
- **Protección Anti-Fuerza Bruta (Rate Limiting):** Bloqueo automático temporal por IP tras 5 intentos fallidos de inicio de sesión y comparación criptográfica `timingSafeEqual`.
- **Sanitización contra Path Traversal e Inyección:** Todos los nombres de proyectos, contenedores, ramas y dominios se validan estrictamente y se confinan dentro de `PROJECTS_ROOT`.
- **Permisos `.env` Restringidos (`0600`):** Al crear o editar variables de entorno desde el panel, el archivo se protege con permisos `0600`.
- **Registro de Auditoría (`Audit Log`):** Registra cada acción crítica (`GIT_PULL_DEPLOY`, `DOCKER_RESTART`, `DB_EXPORT_SQL`, `ENV_UPDATE`, `AUTH_LOGIN`) con IP y fecha sin exponer secretos en los logs.

---

## 🔐 Arquitectura de Permisos por Rol, Módulos y Servicios (Estilo GitHub Classic Token)

En **ALpanel**, los permisos se asignan **por Rol** (nunca por usuario individual; cada usuario hereda los permisos de su Rol asignado, y un proyecto puede sobreescribir el Rol de un usuario específico mediante `ProjectMember`).

La interfaz de **Roles & Permisos** funciona igual que los **Personal Access Tokens (Classic) de GitHub**:
1. **Nivel 1 — Módulo Padre (`src/modules/<modulo>`):** Controla si el Rol tiene acceso a la vista/módulo principal.
2. **Nivel 2 — Sub-Servicios del Módulo (`src/services/<modulo>/*.service.ts`):** Permite habilitar el módulo padre para un Rol pero **restringir qué servicios específicos puede usar dentro de ese módulo** (por ejemplo, permitir ver logs y reiniciar contenedores en `projects`, pero prohibir detener contenedores, editar `.env` o descargar backups SQL).
3. **Regla de Módulo sin Servicios (Permiso de Módulo Completo):** Si un módulo en `src/modules/<modulo>` **NO tiene carpeta o servicios** dentro de `src/services/<modulo>/` (como ocurre con `security` / Auditoría), el permiso aplica automáticamente al **módulo completo**.
4. **Servicios Independientes (`src/services/*.service.ts`):** Los servicios que no pertenecen a un módulo específico se colocan directamente en la raíz de `src/services/` (ej. `src/services/docker-prune.service.ts` $\rightarrow$ `services.docker_prune`) y aparecen agrupados en una sección aparte llamada **Servicios Independientes**.

### Estructura de Carpetas (`src/modules` y `src/services`)

```text
src/
├── config/
│   └── permissions.ignore.json          # Módulos y archivos de servicios ignorados en la vista de permisos (habilitados para todos)
├── modules/                             # Módulos principales del panel
│   ├── auth/                            # (Ignorado en permisos — siempre activo)
│   ├── dashboard/                       # (Ignorado en permisos — siempre activo)
│   ├── projects/                        # Módulo Padre: Proyectos & Contenedores
│   ├── domains/                         # Módulo Padre: Dominios & SSL (Caddy)
│   ├── git/                             # Módulo Padre: Repositorios & Cuentas Git
│   ├── users/                           # Módulo Padre: Usuarios & Accesos
│   ├── security/                        # Módulo Padre sin sub-servicios (el permiso controla el módulo completo)
│   ├── roles/                           # (Ignorado en permisos — administración interna)
│   └── permissions/                     # (Ignorado en permisos — administración interna)
└── services/                            # Servicios granulares divididos por carpeta de módulo o independientes
    ├── service-registry.ts              # Escáner automático de módulos y servicios
    ├── crypto.service.ts                # (Ignorado en permissions.ignore.json — uso interno global)
    ├── host.service.ts                  # (Ignorado en permissions.ignore.json — uso interno global)
    ├── docker-prune.service.ts          # ⚡ Servicio Independiente -> código: services.docker_prune
    ├── projects/                        # 📦 Sub-servicios del módulo "projects"
    │   ├── container-logs.service.ts    # -> projects.logs (Ver Logs y Métricas)
    │   ├── container-restart.service.ts # -> projects.restart_cache (Reiniciar y Limpiar Caché)
    │   ├── container-power.service.ts   # -> projects.stop_rebuild (Detener, Eliminar y Rebuild)
    │   ├── project-db.service.ts        # -> projects.db_view y projects.db_backup (Inspector y Backup SQL)
    │   ├── project-env.service.ts       # -> projects.env_view y projects.env_edit (Variables .env)
    │   ├── git-devmode.service.ts       # -> projects.dev_mode (Modo Desarrollador Git)
    │   └── git-deploy.service.ts        # -> projects.git_pull (Git Pull & Restart)
    ├── domains/                         # 🌐 Sub-servicios del módulo "domains"
    │   └── caddy-ssl.service.ts         # -> domains.manage (Gestionar Dominios y SSL)
    ├── git/                             # 🔑 Sub-servicios del módulo "git"
    │   └── git-clone.service.ts         # -> git.clone (Cuentas Git y Clonar Proyectos)
    └── users/                           # 👥 Sub-servicios del módulo "users"
        └── users-roles.service.ts       # -> users.manage (Gestionar Usuarios y Roles)
```

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

