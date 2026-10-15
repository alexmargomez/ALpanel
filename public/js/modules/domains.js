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
      showToast('Ruta de dominio guardada en MariaDB (Prisma)');
      await loadDomains();
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

  const canDelete = hasPerm('domains', 'delete');
  const data = await apiFetch('/api/domains');
  document.getElementById('caddyfile-preview').innerText = data.caddyfile || '';
  const list = document.getElementById('domains-list');
  list.innerHTML =
    (data.routes || [])
      .map(
        (r) => `
      <div class="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <a href="https://${r.domain}" target="_blank" class="font-bold text-indigo-400 hover:underline text-sm">${r.domain}</a>
            <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">${r.projectName}</span>
          </div>
          <div class="text-slate-400 font-mono text-[11px]">
            Front: <strong class="text-slate-200">${r.frontendTarget}</strong>
            ${r.backendTarget ? ` | Ruta <code>${r.apiPathPrefix || '/api/*'}</code> &rarr; <strong class="text-emerald-400">${r.backendTarget}</strong>` : ''}
          </div>
        </div>
        ${
          canDelete
            ? `<button onclick="deleteDomain('${r.id}')" class="p-2 text-rose-400 hover:bg-rose-950/60 rounded-lg" title="Eliminar dominio">
                <i class="fa-solid fa-trash"></i>
              </button>`
            : ''
        }
      </div>`
      )
      .join('') || '<div class="text-xs text-slate-500">No hay rutas personalizadas guardadas aún.</div>';
}

async function deleteDomain(id) {
  try {
    await apiFetch(`/api/domains/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('Dominio eliminado');
    await loadDomains();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}
