function extractContainerInternalTarget(container) {
  let internalPort = '3000';
  if (Array.isArray(container.ports) && container.ports.length > 0) {
    const firstPort = String(container.ports[0]);
    const arrowMatch = /->(\d+)/.exec(firstPort);
    const numMatch = /(\d+)/.exec(firstPort);
    if (arrowMatch) {
      internalPort = arrowMatch[1];
    } else if (numMatch) {
      internalPort = numMatch[1];
    }
  } else if (container.name.includes('django')) {
    internalPort = '8000';
  } else if (container.name.includes('alpanel')) {
    internalPort = '9000';
  }
  return `${container.name}:${internalPort}`;
}

function populateDomainProjectSelect(selectedValue = '') {
  const select = document.getElementById('dom-project');
  if (!select) return;
  const currentVal = selectedValue || select.value || '';

  const optionsHtml = [
    '<option value="">Selecciona un proyecto...</option>',
    ...(allProjects || []).map((p) => {
      const appContainers = (p.containers || []).filter(
        (c) => c.role !== 'database' && c.role !== 'proxy'
      );
      const targetsLabel =
        appContainers.length > 0
          ? appContainers.map((c) => extractContainerInternalTarget(c)).join(', ')
          : 'Sin contenedores activos';
      const isSelected = p.name.toLowerCase() === currentVal.toLowerCase() ? 'selected' : '';
      return `<option value="${p.name}" ${isSelected}>${p.name} (${targetsLabel})</option>`;
    }),
  ];

  // Si había un proyecto guardado que no está aún en allProjects, mantenerlo en la lista
  if (
    currentVal &&
    !(allProjects || []).some((p) => p.name.toLowerCase() === currentVal.toLowerCase())
  ) {
    optionsHtml.push(`<option value="${currentVal}" selected>${currentVal}</option>`);
  }

  select.innerHTML = optionsHtml.join('');
}

function onDomainProjectSelectChange() {
  const select = document.getElementById('dom-project');
  const frontInput = document.getElementById('dom-front');
  const backInput = document.getElementById('dom-back');
  const hintBox = document.getElementById('dom-project-containers-hint');
  if (!select) return;

  const projectName = select.value.trim();
  const proj = (allProjects || []).find(
    (p) => p.name.toLowerCase() === projectName.toLowerCase()
  );

  if (!proj) {
    if (hintBox) hintBox.classList.add('hidden');
    return;
  }

  const appContainers = (proj.containers || []).filter(
    (c) => c.role !== 'database' && c.role !== 'proxy'
  );
  const frontContainer =
    appContainers.find((c) => c.role === 'frontend') || appContainers[0] || null;
  const backContainer =
    appContainers.length > 1
      ? appContainers.find((c) => c.role === 'backend' && c !== frontContainer) || null
      : null;

  if (frontContainer && frontInput) {
    frontInput.value = extractContainerInternalTarget(frontContainer);
  }
  if (backInput) {
    backInput.value = backContainer ? extractContainerInternalTarget(backContainer) : '';
  }

  if (hintBox) {
    if (appContainers.length > 0) {
      const chips = appContainers
        .map((c) => {
          const target = extractContainerInternalTarget(c);
          return `
            <div class="inline-flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1">
              <span class="w-2 h-2 rounded-full ${
                c.state === 'running' ? 'bg-emerald-400' : 'bg-rose-500'
              }"></span>
              <code class="text-emerald-300 font-mono text-[11px]">${target}</code>
              <span class="text-[10px] text-slate-400">(${c.role})</span>
              <button type="button" onclick="document.getElementById('dom-front').value='${target}'" class="ml-1 px-1.5 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-[10px] font-semibold">
                Usar en Front
              </button>
              <button type="button" onclick="document.getElementById('dom-back').value='${target}'" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold">
                Usar en /api/*
              </button>
            </div>
          `;
        })
        .join('');
      hintBox.innerHTML = `<span class="text-slate-400 text-[11px] font-semibold"><i class="fa-solid fa-wand-magic-sparkles text-indigo-400 mr-1"></i>Contenedores de ${proj.name}:</span> ${chips}`;
      hintBox.classList.remove('hidden');
    } else {
      hintBox.innerHTML = `<span class="text-amber-300 text-[11px]"><i class="fa-solid fa-triangle-exclamation mr-1"></i>El proyecto <strong>${proj.name}</strong> aún no tiene contenedores activos; escribe el nombre del contenedor y puerto manualmente.</span>`;
      hintBox.classList.remove('hidden');
    }
  }
}

function prefillDomainForm(domain, projectName, frontendTarget, backendTarget) {
  populateDomainProjectSelect(projectName);
  const domInput = document.getElementById('dom-domain');
  const frontInput = document.getElementById('dom-front');
  const backInput = document.getElementById('dom-back');
  if (domInput) domInput.value = domain || '';
  if (frontInput) frontInput.value = frontendTarget || '';
  if (backInput) backInput.value = backendTarget || '';
  const box = document.getElementById('domains-create-box');
  if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initDomainForm() {
  const form = document.getElementById('domain-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      domain: document.getElementById('dom-domain').value.trim(),
      projectName: document.getElementById('dom-project').value.trim(),
      frontendTarget: document.getElementById('dom-front').value.trim(),
      apiPathPrefix: '/api/*',
      backendTarget: document.getElementById('dom-back').value.trim(),
      sslEnabled: true,
    };
    try {
      await apiFetch('/api/domains', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      e.target.reset();
      const hintBox = document.getElementById('dom-project-containers-hint');
      if (hintBox) hintBox.classList.add('hidden');
      showToast('Ruta de dominio guardada y aplicada en Caddy SSL');
      await loadDomains();
      if (typeof refreshAll === 'function') await refreshAll();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  });
}

async function loadDomains() {
  const createBox = document.getElementById('domains-create-box');
  if (createBox) {
    createBox.classList.toggle('hidden', !hasPerm('domains', 'create'));
  }

  if (!allProjects || allProjects.length === 0) {
    try {
      const projData = await apiFetch('/api/projects');
      allProjects = projData.projects || [];
    } catch {}
  }
  populateDomainProjectSelect();

  const canDelete = hasPerm('domains', 'delete');
  const canEdit = hasPerm('domains', 'edit');
  const data = await apiFetch('/api/domains');
  document.getElementById('caddyfile-preview').innerText = data.caddyfile || '';
  const list = document.getElementById('domains-list');
  list.innerHTML =
    (data.routes || [])
      .map(
        (r) => `
      <div class="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs">
        <div class="space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <a href="https://${r.domain}" target="_blank" class="font-bold text-indigo-400 hover:underline text-sm">${r.domain}</a>
            <span class="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[10px] font-semibold">
              <i class="fa-solid fa-layer-group mr-1"></i>${r.projectName}
            </span>
          </div>
          <div class="text-slate-400 font-mono text-[11px]">
            Front: <strong class="text-emerald-300">${r.frontendTarget}</strong>
            ${r.backendTarget ? ` | Ruta <code>${r.apiPathPrefix || '/api/*'}</code> &rarr; <strong class="text-indigo-300">${r.backendTarget}</strong>` : ''}
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          ${
            canEdit
              ? `<button onclick="prefillDomainForm('${r.domain}', '${r.projectName}', '${r.frontendTarget}', '${r.backendTarget || ''}')" class="px-2.5 py-1.5 text-amber-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-[11px] font-semibold" title="Editar ruta de dominio">
                  <i class="fa-solid fa-pen"></i>
                </button>`
              : ''
          }
          ${
            canDelete
              ? `<button onclick="deleteDomain('${r.id}')" class="px-2.5 py-1.5 text-rose-400 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 rounded-lg text-[11px] font-semibold" title="Eliminar dominio">
                  <i class="fa-solid fa-trash"></i>
                </button>`
              : ''
          }
        </div>
      </div>`
      )
      .join('') || '<div class="text-xs text-slate-500">No hay rutas personalizadas guardadas aún.</div>';
}

async function deleteDomain(id) {
  try {
    await apiFetch(`/api/domains/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('Dominio eliminado');
    await loadDomains();
    if (typeof refreshAll === 'function') await refreshAll();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}
