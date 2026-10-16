function renderProjects() {
  const grid = document.getElementById('projects-grid');
  if (!grid) return;
  const searchEl = document.getElementById('project-search');
  const q = ((searchEl && searchEl.value) || '').toLowerCase().trim();
  const filtered = allProjects.filter((p) => {
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.domains.some((d) => d.toLowerCase().includes(q)) ||
      p.stack.some((s) => s.toLowerCase().includes(q))
    );
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 text-sm">
        No se encontraron proyectos con ese filtro.
      </div>`;
    return;
  }

  const canDeployProjects = hasPerm('projects', 'deploy'); // Restart y Limpiar Caché
  const canStopRebuildServer = hasPerm('projects', 'delete'); // Detener, Iniciar y Rebuild
  const canViewLogs = hasPerm('projects', 'edit'); // Ver Logs
  const canViewDb = hasPerm('project_db', 'view'); // Ver Base de Datos
  const canViewEnv = hasPerm('project_env', 'view'); // Ver .env
  const canDeployGitProd = hasPerm('git', 'deploy'); // Git Pull & Restart (main)
  const canUseDevMode = hasPerm('git', 'edit'); // Modo Desarrollador (develop)
  const canManageAppUsers = hasPerm('projects.app_users', 'view'); // Usuarios propios de cada App

  grid.innerHTML = filtered
    .map((p) => {
      const statusBadge =
        p.status === 'running'
          ? '<span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><i class="fa-solid fa-circle text-[8px] mr-1"></i>ACTIVO</span>'
          : p.status === 'partial'
          ? '<span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">PARCIAL</span>'
          : '<span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">DETENIDO</span>';

      const updateBadge =
        p.git.behindCount > 0
          ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
              <i class="fa-solid fa-arrow-up mr-1"></i>${p.git.behindCount} commit(s) por bajar
            </span>`
          : '';

      const domainsHtml = p.domains.length
        ? p.domains
            .map(
              (d) =>
                `<a href="https://${d}" target="_blank" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 text-xs font-medium transition">
                  <i class="fa-solid fa-lock text-[10px] text-emerald-400"></i> ${d} <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                </a>`
            )
            .join(' ')
        : '<span class="text-xs text-slate-500">Sin dominio asignado</span>';

      const stackBadges = p.stack
        .map((s) => `<span class="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[11px] font-medium">${s}</span>`)
        .join('');

      const containersRows = p.containers
        .map((c) => {
          const roleBadge =
            c.role === 'database'
              ? '<span class="text-amber-400"><i class="fa-solid fa-database mr-1"></i>DB</span>'
              : c.role === 'proxy'
              ? '<span class="text-emerald-400"><i class="fa-solid fa-shield-halved mr-1"></i>SSL Proxy</span>'
              : c.role === 'frontend'
              ? '<span class="text-sky-400"><i class="fa-solid fa-desktop mr-1"></i>Frontend</span>'
              : '<span class="text-indigo-400"><i class="fa-solid fa-gears mr-1"></i>Backend</span>';

          const dot = c.state === 'running' ? 'bg-emerald-400' : 'bg-rose-500';

          return `
            <div class="flex flex-wrap items-center justify-between gap-2 bg-slate-950/80 border border-slate-800/80 rounded-xl px-3.5 py-2 text-xs">
              <div class="flex items-center gap-2.5 min-w-[180px]">
                <span class="w-2 h-2 rounded-full ${dot}"></span>
                <span class="font-semibold text-white">${c.name}</span>
                <span class="text-[11px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800">${roleBadge}</span>
              </div>
              <div class="text-slate-400 text-[11px] font-mono">${c.image}</div>
              <div class="flex items-center gap-4 text-[11px]">
                <span>CPU: <strong class="text-slate-200">${c.cpuPercent}%</strong></span>
                <span>RAM: <strong class="text-emerald-400">${formatBytes(c.memoryBytes)}</strong></span>
                ${c.ports.length ? `<span class="text-slate-400 hidden sm:inline"><i class="fa-solid fa-plug mr-1"></i>${c.ports.join(', ')}</span>` : ''}
              </div>
              <div class="flex items-center gap-1.5">
                ${
                  canDeployProjects
                    ? `<button onclick="runAction('${p.name}', 'restart', { containerName: '${c.name}' })" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px]" title="Reiniciar solo este contenedor">
                        <i class="fa-solid fa-rotate"></i> Restart
                      </button>`
                    : ''
                }
                ${
                  canViewLogs
                    ? `<button onclick="openLogsModal('${p.name}', '${c.name}')" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[11px]" title="Ver logs de este contenedor">
                        <i class="fa-solid fa-terminal"></i> Logs
                      </button>`
                    : ''
                }
              </div>
            </div>`;
        })
        .join('');

      return `
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="space-y-1.5">
              <div class="flex flex-wrap items-center gap-2.5">
                <h3 class="text-lg font-bold text-white">${p.name}</h3>
                ${statusBadge}
                ${updateBadge}
                <div class="flex flex-wrap gap-1.5">${stackBadges}</div>
              </div>
              <div class="flex flex-wrap items-center gap-3 pt-0.5">
                ${domainsHtml}
                <span class="text-xs text-slate-400 font-mono">
                  <i class="fa-brands fa-git-alt text-orange-400 mr-1"></i>${p.git.branch} (${p.git.commitHash})
                </span>
                ${
                  p.git.isRepo && hasPerm('git', 'view')
                    ? `<button onclick="checkGitUpdates('${p.name}')" class="text-[11px] text-indigo-400 hover:underline" title="Consultar si hay nuevos commits en el repositorio remoto">
                        <i class="fa-solid fa-magnifying-glass mr-1"></i>Verificar remoto
                      </button>`
                    : ''
                }
              </div>
            </div>

            <div class="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs">
              <div>
                <span class="text-slate-400 block text-[10px] uppercase">CPU Proyecto</span>
                <span class="font-bold text-indigo-400 text-sm">${p.resources.cpuPercent}%</span>
              </div>
              <div class="h-6 w-px bg-slate-800 mx-1"></div>
              <div>
                <span class="text-slate-400 block text-[10px] uppercase">RAM Usada</span>
                <span class="font-bold text-emerald-400 text-sm">${formatBytes(p.resources.memoryBytes)}</span>
              </div>
              <div class="h-6 w-px bg-slate-800 mx-1"></div>
              <div>
                <span class="text-slate-400 block text-[10px] uppercase">Disco</span>
                <span class="font-bold text-amber-400 text-sm">${formatBytes(p.resources.diskBytes)}</span>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
            ${
              canDeployGitProd
                ? `<button onclick="runAction('${p.name}', 'pull')" class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-md shadow-indigo-600/20" title="Ejecuta git pull + docker compose restart con Rollback automático si falla">
                    <i class="fa-solid fa-cloud-arrow-down"></i> Git Pull & Restart
                  </button>`
                : ''
            }

            ${
              canDeployProjects
                ? `<button onclick="runAction('${p.name}', 'restart')" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5">
                    <i class="fa-solid fa-rotate"></i> Restart Docker
                  </button>
                  <button onclick="runAction('${p.name}', 'clear-cache')" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5">
                    <i class="fa-solid fa-broom"></i> Limpiar Caché
                  </button>`
                : ''
            }

            ${
              canViewDb
                ? `<button onclick="openDbModal('${p.name}')" class="px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold transition flex items-center gap-1.5">
                    <i class="fa-solid fa-database"></i> Base de Datos
                  </button>`
                : ''
            }

            ${
              !['serverpanel', 'alpanel'].includes(p.name.toLowerCase()) &&
              p.database &&
              p.database.hasDatabase &&
              canManageAppUsers
                ? `<button onclick="openAppUsersModal('${p.name}')" class="px-3 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-semibold transition flex items-center gap-1.5" title="Ver, crear y cambiar contraseñas de usuarios internos de ${p.name}">
                    <i class="fa-solid fa-users-rectangle"></i> Usuarios App
                  </button>`
                : ''
            }

            ${
              canViewEnv
                ? `<button onclick="openEnvModal('${p.name}')" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5">
                    <i class="fa-solid fa-key"></i> .env
                  </button>`
                : ''
            }

            ${
              canViewLogs
                ? `<button onclick="openLogsModal('${p.name}')" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5">
                    <i class="fa-solid fa-terminal"></i> Logs
                  </button>`
                : ''
            }

            ${
              canStopRebuildServer
                ? `<button onclick="runAction('${p.name}', 'rebuild')" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5" title="Reconstruir imágenes Docker (docker compose up -d --build)">
                    <i class="fa-solid fa-hammer"></i> Rebuild
                  </button>`
                : ''
            }

            ${
              canUseDevMode
                ? p.devMode && p.devMode.isActive
                  ? `<button onclick="runAction('${p.name}', 'dev-activate')" class="px-3 py-2 rounded-xl bg-fuchsia-600/20 hover:bg-fuchsia-600/30 text-fuchsia-300 border border-fuchsia-500/40 text-xs font-semibold transition flex items-center gap-1.5" title="Sincronizar últimos commits de origin/develop en el entorno de pruebas">
                      <i class="fa-solid fa-flask"></i> Actualizar Dev (develop)
                    </button>
                    <button onclick="runAction('${p.name}', 'dev-deactivate')" class="px-3 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-semibold transition flex items-center gap-1.5" title="Apagar Modo Desarrollador y liberar subdominio de pruebas">
                      <i class="fa-solid fa-power-off"></i> Apagar Modo Dev
                    </button>`
                  : `<button onclick="runAction('${p.name}', 'dev-activate')" class="px-3 py-2 rounded-xl bg-fuchsia-950/60 hover:bg-fuchsia-900/60 text-fuchsia-300 border border-fuchsia-700/50 text-xs font-semibold transition flex items-center gap-1.5" title="Desplegar rama develop de este proyecto en el subdominio de pruebas">
                      <i class="fa-solid fa-flask"></i> Modo Desarrollador
                    </button>`
                : ''
            }

            ${
              ['serverpanel', 'alpanel'].includes(p.name.toLowerCase())
                ? `<span class="ml-auto px-3 py-2 rounded-xl bg-emerald-950/40 text-emerald-400 border border-emerald-800/40 text-xs font-semibold flex items-center gap-1.5">
                    <i class="fa-solid fa-shield-halved"></i> Panel Principal
                  </span>`
                : !canStopRebuildServer
                ? ''
                : p.status === 'running'
                ? `<button onclick="runAction('${p.name}', 'stop')" class="ml-auto px-3 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 border border-rose-800/60 text-xs font-semibold transition flex items-center gap-1.5">
                    <i class="fa-solid fa-stop"></i> Detener
                  </button>`
                : `<button onclick="runAction('${p.name}', 'start')" class="ml-auto px-3 py-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-800/60 text-xs font-semibold transition flex items-center gap-1.5">
                    <i class="fa-solid fa-play"></i> Iniciar
                  </button>`
            }
          </div>

          ${
            p.devMode && p.devMode.isActive
              ? `<div class="flex flex-wrap items-center justify-between gap-3 bg-fuchsia-950/30 border border-fuchsia-500/40 rounded-xl px-4 py-2.5 text-xs">
                  <div class="flex flex-wrap items-center gap-2.5">
                    <span class="px-2 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 font-bold text-[11px]">
                      <i class="fa-solid fa-flask mr-1"></i>MODO DESARROLLADOR ACTIVO
                    </span>
                    <span class="text-slate-300 font-mono">
                      <i class="fa-brands fa-git-alt text-fuchsia-400 mr-1"></i>develop (${p.devMode.commitHash})
                    </span>
                    <span class="text-slate-400 truncate max-w-md">${p.devMode.commitMessage || ''}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <a href="https://${p.devMode.domain}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold transition shadow">
                      <i class="fa-solid fa-lock text-[10px]"></i> https://${p.devMode.domain} <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                    </a>
                    <button onclick="openLogsModal('${p.name}', 'alpanel_dev_app')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-fuchsia-200 border border-slate-700">
                      <i class="fa-solid fa-terminal mr-1"></i>Logs Dev
                    </button>
                  </div>
                </div>`
              : ''
          }

          <div class="space-y-1.5 pt-1">
            <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Contenedores del Proyecto (${p.containers.length})
            </div>
            ${containersRows || '<div class="text-xs text-slate-500 italic">No hay contenedores creados para este proyecto todavía.</div>'}
          </div>
        </div>`;
    })
    .join('');
}

function openDbModal(projectName) {
  const proj = allProjects.find((p) => p.name === projectName);
  if (!proj) return;
  const db = proj.database;
  document.getElementById('db-modal-subtitle').innerText = `Proyecto: ${proj.name} (${db.engine})`;
  const body = document.getElementById('db-modal-body');
  const dumpBtn = document.getElementById('db-dump-btn');

  if (!db.hasDatabase) {
    dumpBtn.classList.add('hidden');
    body.innerHTML = `<div class="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-400">Este proyecto no tiene un contenedor o configuración de Base de Datos detectada en su <code>.env</code> o <code>docker-compose.yml</code>.</div>`;
  } else {
    dumpBtn.classList.toggle('hidden', !hasPerm('project_db', 'deploy'));
    dumpBtn.onclick = () => downloadSqlBackup(proj.name);

    const fields = [
      { label: 'Host / IP Pública (DBeaver, TablePlus, Navicat)', value: db.host, icon: 'fa-network-wired' },
      { label: 'Puerto Externo (Host -> Contenedor)', value: `${db.port} (interno: ${db.internalPort})`, copyVal: db.port, icon: 'fa-plug' },
      { label: 'Nombre de la Base de Datos (Database)', value: db.database, icon: 'fa-database' },
      { label: 'Usuario (Username)', value: db.username, icon: 'fa-user' },
      { label: 'Contraseña (Password)', value: db.password, secret: true, icon: 'fa-key' },
      { label: `Contraseña Root (${db.rootUsername})`, value: db.rootPassword, secret: true, icon: 'fa-user-shield' },
      { label: 'Host Interno Docker (Entre contenedores)', value: db.internalHost, icon: 'fa-cube' },
    ];

    body.innerHTML = `
      <div class="space-y-2.5">
        ${fields
          .map(
            (f, idx) => `
          <div class="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5">
            <div class="min-w-0 pr-2">
              <div class="text-[10px] uppercase tracking-wider text-slate-400">${f.label}</div>
              <div class="font-mono text-sm text-white truncate" id="db-field-${idx}" data-real="${f.value}">
                ${f.secret ? '••••••••••••' : f.value}
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              ${
                f.secret
                  ? `<button onclick="toggleSecret('db-field-${idx}')" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="Mostrar/Ocultar">
                      <i class="fa-regular fa-eye"></i>
                    </button>`
                  : ''
              }
              <button onclick="copyText('${(f.copyVal || f.value).replace(/'/g, "\\'")}', '${f.label} copiado')" class="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-semibold">
                <i class="fa-regular fa-copy mr-1"></i>Copiar
              </button>
            </div>
          </div>`
          )
          .join('')}

        <div class="bg-slate-950 border border-slate-800 rounded-xl p-3">
          <div class="flex justify-between items-center mb-1">
            <span class="text-[10px] uppercase tracking-wider text-slate-400">URL de Conexión Directa</span>
            <button onclick="copyText('${db.connectionUrl.replace(/'/g, "\\'")}', 'URL de conexión copiada')" class="text-indigo-400 hover:underline">Copiar URL</button>
          </div>
          <code class="block text-[11px] text-emerald-400 font-mono break-all">${db.connectionUrl}</code>
        </div>

        <div class="bg-slate-950 border border-slate-800 rounded-xl p-3">
          <div class="flex justify-between items-center mb-1">
            <span class="text-[10px] uppercase tracking-wider text-slate-400">Comando Terminal</span>
            <button onclick="copyText('${db.cliCommand.replace(/'/g, "\\'")}', 'Comando copiado')" class="text-indigo-400 hover:underline">Copiar Comando</button>
          </div>
          <code class="block text-[11px] text-amber-300 font-mono break-all">${db.cliCommand}</code>
        </div>
      </div>`;
  }

  document.getElementById('db-modal').classList.remove('hidden');
}

async function downloadSqlBackup(projectName) {
  showToast(`Generando backup SQL de ${projectName}...`);
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/db-dump`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error generando backup');
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}_backup.sql`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('Backup SQL descargado exitosamente');
  } catch (e) {
    showToast(`Error: ${e.message}`);
  }
}

function toggleSecret(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const real = el.getAttribute('data-real') || '';
  el.innerText = el.innerText === '••••••••••••' ? real : '••••••••••••';
}

async function runAction(projectName, action, body = {}) {
  const titleMap = {
    pull: `Git Pull & Restart (Rama main con Rollback Automático) — ${projectName}`,
    restart: `Reiniciando Docker — ${projectName}`,
    'clear-cache': `Limpiando Caché — ${projectName}`,
    rebuild: `Reconstruyendo Imágenes (Rebuild) — ${projectName}`,
    start: `Iniciando Proyecto — ${projectName}`,
    stop: `Deteniendo Proyecto — ${projectName}`,
    'dev-activate': `Modo Desarrollador (rama develop) — ${projectName}`,
    'dev-deactivate': `Apagando Modo Desarrollador — ${projectName}`,
  };
  document.getElementById('console-modal-title').innerText = titleMap[action] || `Ejecutando ${action}`;
  document.getElementById('console-container-select').classList.add('hidden');
  const out = document.getElementById('console-modal-output');
  out.innerText = '⏳ Ejecutando comando en el servidor, por favor espera...\n';
  document.getElementById('console-modal').classList.remove('hidden');

  try {
    const res = await apiFetch(`/api/projects/${encodeURIComponent(projectName)}/${action}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    out.innerText = res.output || 'Comando finalizado.';
    if (['serverpanel', 'alpanel'].includes(projectName.toLowerCase()) && ['pull', 'restart', 'rebuild'].includes(action)) {
      setTimeout(() => {
        refreshAll().catch(() => {});
      }, 3500);
    } else {
      await refreshAll();
    }
  } catch (e) {
    out.innerText = `❌ Error: ${e.message}`;
  }
}

async function openLogsModal(projectName, preferredContainer = '') {
  const proj = allProjects.find((p) => p.name === projectName);
  if (!proj || proj.containers.length === 0) {
    showToast('Este proyecto no tiene contenedores activos');
    return;
  }
  currentLogsProject = projectName;
  const select = document.getElementById('console-container-select');
  select.innerHTML = proj.containers
    .map((c) => `<option value="${c.name}" ${c.name === preferredContainer ? 'selected' : ''}>${c.name} (${c.role})</option>`)
    .join('');
  select.classList.remove('hidden');
  document.getElementById('console-modal-title').innerText = `Logs en Vivo — ${projectName}`;
  document.getElementById('console-modal').classList.remove('hidden');
  await loadSelectedContainerLogs();
}

async function loadSelectedContainerLogs() {
  const select = document.getElementById('console-container-select');
  const container = select.value;
  const out = document.getElementById('console-modal-output');
  out.innerText = `⏳ Cargando últimas 150 líneas de ${container}...`;
  const res = await apiFetch(
    `/api/projects/${encodeURIComponent(currentLogsProject)}/logs?container=${encodeURIComponent(container)}&tail=150`
  );
  out.innerText = res.logs || 'Sin salida de logs.';
  out.scrollTop = out.scrollHeight;
}

async function openEnvModal(projectName) {
  currentEnvProject = projectName;
  document.getElementById('env-modal-title').innerHTML = `<i class="fa-solid fa-key text-amber-400 mr-2"></i>Archivo .env — ${projectName}`;
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectName)}/env`);
  document.getElementById('env-modal-textarea').value = res.content || '';
  document.getElementById('env-modal').classList.remove('hidden');
}

async function saveEnvFile(restart = true) {
  const content = document.getElementById('env-modal-textarea').value;
  closeModal('env-modal');
  document.getElementById('console-modal-title').innerText = `Guardando .env y Reiniciando — ${currentEnvProject}`;
  document.getElementById('console-container-select').classList.add('hidden');
  const out = document.getElementById('console-modal-output');
  out.innerText = '⏳ Guardando archivo .env y reiniciando contenedores...';
  document.getElementById('console-modal').classList.remove('hidden');

  const res = await apiFetch(`/api/projects/${encodeURIComponent(currentEnvProject)}/env`, {
    method: 'POST',
    body: JSON.stringify({ content, restart }),
  });
  out.innerText = res.output || 'Guardado correctamente.';
  await refreshAll();
}

async function refreshAll() {
  if (!hasPerm('projects', 'view')) return;
  const data = await apiFetch('/api/projects');
  updateHostUI(data.host);
  const rootLbl = document.getElementById('projects-root-label');
  if (rootLbl) rootLbl.innerText = data.projectsRoot || '/opt/projects';
  allProjects = data.projects || [];
  renderProjects();
}

let currentAppUsersProject = '';

function resetAppUserForm() {
  const idEl = document.getElementById('app-user-id');
  const userEl = document.getElementById('app-user-username');
  const emailEl = document.getElementById('app-user-email');
  const roleEl = document.getElementById('app-user-role');
  const passEl = document.getElementById('app-user-password');
  const formTitle = document.getElementById('app-user-form-title');
  const passLabel = document.getElementById('app-user-pass-label');
  const submitText = document.getElementById('app-user-submit-text');
  const cancelBtn = document.getElementById('app-user-cancel-edit');

  if (idEl) idEl.value = '';
  if (userEl) userEl.value = '';
  if (emailEl) emailEl.value = '';
  if (roleEl) roleEl.value = 'admin';
  if (passEl) {
    passEl.value = '';
    passEl.required = true;
  }
  if (formTitle) {
    formTitle.innerHTML = `<i class="fa-solid fa-user-plus"></i> Crear Nuevo Usuario en ${currentAppUsersProject}`;
  }
  if (passLabel) passLabel.innerText = 'Contraseña (obligatoria)';
  if (submitText) submitText.innerText = 'Crear Usuario en la BD';
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

function prefillAppUserForm(id, username, email, role) {
  const idEl = document.getElementById('app-user-id');
  const userEl = document.getElementById('app-user-username');
  const emailEl = document.getElementById('app-user-email');
  const roleEl = document.getElementById('app-user-role');
  const passEl = document.getElementById('app-user-password');
  const formTitle = document.getElementById('app-user-form-title');
  const passLabel = document.getElementById('app-user-pass-label');
  const submitText = document.getElementById('app-user-submit-text');
  const cancelBtn = document.getElementById('app-user-cancel-edit');

  if (idEl) idEl.value = String(id);
  if (userEl) userEl.value = username || '';
  if (emailEl) emailEl.value = email || '';
  if (roleEl) roleEl.value = role || 'admin';
  if (passEl) {
    passEl.value = '';
    passEl.required = false;
  }
  if (formTitle) {
    formTitle.innerHTML = `<i class="fa-solid fa-user-pen text-amber-400"></i> Editando Usuario #${id} (${username})`;
  }
  if (passLabel) passLabel.innerText = 'Nueva Contraseña (Opcional)';
  if (submitText) submitText.innerText = 'Guardar Cambios';
  if (cancelBtn) cancelBtn.classList.remove('hidden');
}

async function openAppUsersModal(projectName) {
  currentAppUsersProject = projectName;
  resetAppUserForm();
  const titleEl = document.getElementById('app-users-modal-title');
  const subEl = document.getElementById('app-users-modal-subtitle');
  const listEl = document.getElementById('app-users-list');
  const formEl = document.getElementById('app-user-form');

  if (titleEl) titleEl.innerText = `Usuarios Internos — ${projectName}`;
  if (subEl) subEl.innerText = 'Consultando base de datos del proyecto...';
  if (listEl) listEl.innerHTML = '<div class="text-slate-400 py-4 text-center">⏳ Consultando usuarios en el contenedor de base de datos...</div>';

  document.getElementById('app-users-modal').classList.remove('hidden');

  try {
    const data = await apiFetch(`/api/projects/${encodeURIComponent(projectName)}/app-users`);
    if (subEl) {
      subEl.innerHTML = `${data.engine} • Tabla: <code class="text-sky-300 font-mono">${data.tableName}</code> • Hash: <code class="text-emerald-300 font-mono">${data.hashAlgorithm}</code>`;
    }

    const emailWrap = document.getElementById('app-user-email-wrap');
    if (emailWrap) {
      emailWrap.classList.toggle('hidden', !data.hasEmail);
    }

    if (!data.supported) {
      if (formEl) formEl.classList.add('hidden');
      if (listEl) {
        listEl.innerHTML = `
          <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-400">
            <i class="fa-solid fa-circle-info text-amber-400 mr-1.5"></i>${data.message || 'Este proyecto no tiene tabla de usuarios estándar.'}
          </div>`;
      }
      return;
    }

    if (formEl) formEl.classList.remove('hidden');
    const users = data.users || [];
    if (listEl) {
      listEl.innerHTML =
        users
          .map(
            (u) => `
          <div class="flex flex-wrap items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3">
            <div class="flex items-center gap-2.5">
              <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 font-mono text-[10px]">#${u.id}</span>
              <span class="font-bold text-white font-mono text-xs">${u.username}</span>
              ${u.email ? `<span class="text-slate-400 text-[11px]">(${u.email})</span>` : ''}
              <span class="px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-semibold">${u.role || 'admin'}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <button type="button" onclick="prefillAppUserForm('${u.id}', '${u.username.replace(/'/g, "\\'")}', '${(u.email || '').replace(/'/g, "\\'")}', '${(u.role || 'admin').replace(/'/g, "\\'")}')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-[11px] font-semibold">
                <i class="fa-solid fa-key mr-1"></i>Editar / Clave
              </button>
              <button type="button" onclick="deleteAppUserItem('${u.id}', '${u.username.replace(/'/g, "\\'")}')" class="px-2.5 py-1 rounded-lg bg-rose-950/50 hover:bg-rose-900/70 text-rose-300 border border-rose-800/50 text-[11px] font-semibold">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>`
          )
          .join('') || '<div class="text-slate-500 italic py-2">No hay usuarios registrados en la tabla de este proyecto.</div>';
    }
  } catch (err) {
    if (listEl) {
      listEl.innerHTML = `<div class="text-rose-400 bg-rose-950/30 border border-rose-800/40 rounded-xl p-3">❌ ${err.message}</div>`;
    }
  }
}

async function submitAppUserForm(e) {
  e.preventDefault();
  if (!currentAppUsersProject) return;
  const payload = {
    id: document.getElementById('app-user-id').value.trim() || undefined,
    username: document.getElementById('app-user-username').value.trim(),
    email: document.getElementById('app-user-email').value.trim(),
    role: document.getElementById('app-user-role').value,
    password: document.getElementById('app-user-password').value,
    isActive: true,
  };

  try {
    const res = await apiFetch(`/api/projects/${encodeURIComponent(currentAppUsersProject)}/app-users`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    showToast(res.message || 'Usuario guardado');
    await openAppUsersModal(currentAppUsersProject);
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function deleteAppUserItem(userId, username) {
  if (!currentAppUsersProject) return;
  if (!confirm(`¿Seguro que deseas eliminar al usuario "${username}" (#${userId}) de la base de datos de ${currentAppUsersProject}?`)) {
    return;
  }
  try {
    const res = await apiFetch(
      `/api/projects/${encodeURIComponent(currentAppUsersProject)}/app-users/${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    );
    showToast(res.message || 'Usuario eliminado');
    await openAppUsersModal(currentAppUsersProject);
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}
