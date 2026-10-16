async function checkGitUpdates(projectName) {
  showToast(`Verificando repositorio remoto de ${projectName}...`);
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectName)}/check-updates`, {
    method: 'POST',
  });
  showToast(res.output || 'Verificación completada');
  await refreshAll();
}

function openCloneModal() {
  if (!hasPerm('git', 'create')) {
    showToast('No tienes permiso para clonar nuevos proyectos.');
    return;
  }
  document.getElementById('clone-modal').classList.remove('hidden');
}

async function submitCloneForm(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('clone-name').value.trim(),
    repoUrl: document.getElementById('clone-url').value.trim(),
    branch: document.getElementById('clone-branch').value.trim(),
    envContent: document.getElementById('clone-env').value,
    autoStart: document.getElementById('clone-autostart').checked,
  };
  closeModal('clone-modal');
  document.getElementById('console-modal-title').innerText = `Clonando y Desplegando ${payload.name}`;
  document.getElementById('console-container-select').classList.add('hidden');
  const out = document.getElementById('console-modal-output');
  out.innerText = `⏳ Clonando ${payload.repoUrl}...\n`;
  document.getElementById('console-modal').classList.remove('hidden');

  try {
    const res = await apiFetch('/api/projects/clone', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    out.innerText = res.output || 'Proceso finalizado.';
    await refreshAll();
  } catch (err) {
    out.innerText = `❌ Error: ${err.message}`;
  }
}

async function pruneServerDocker() {
  document.getElementById('console-modal-title').innerText = 'Limpiando Caché e Imágenes Huérfanas de Docker';
  document.getElementById('console-container-select').classList.add('hidden');
  const out = document.getElementById('console-modal-output');
  out.innerText = '⏳ Ejecutando docker system prune -f && docker builder prune -f...\n';
  document.getElementById('console-modal').classList.remove('hidden');

  try {
    const res = await apiFetch('/api/system/prune', { method: 'POST' });
    out.innerText = res.output || 'Limpieza completada.';
    await refreshAll();
  } catch (err) {
    out.innerText = `❌ Error: ${err.message}`;
  }
}
