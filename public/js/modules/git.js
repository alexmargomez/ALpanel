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

function generateCryptoHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function injectGeneratedSecret(textareaId, keyName = 'JWT_SECRET', byteLength = 32) {
  const el = document.getElementById(textareaId);
  if (!el) return;
  const secret = generateCryptoHex(byteLength);
  const current = el.value.trim();
  const regex = new RegExp(`^${keyName}\\s*=.*$`, 'm');

  if (regex.test(current)) {
    el.value = current.replace(regex, `${keyName}=${secret}`);
  } else {
    el.value = current ? `${current}\n${keyName}=${secret}` : `${keyName}=${secret}`;
  }
  showToast(`🔑 ${keyName} criptográfico generado y aplicado`);
}

function injectGeneratedDbPassword(textareaId) {
  const el = document.getElementById(textareaId);
  if (!el) return;
  const pass = `db_${generateCryptoHex(12)}`;
  const current = el.value.trim();

  if (/^POSTGRES_PASSWORD\s*=.*$/m.test(current)) {
    el.value = current.replace(/^POSTGRES_PASSWORD\s*=.*$/m, `POSTGRES_PASSWORD=${pass}`);
    showToast('🎲 POSTGRES_PASSWORD actualizado con contraseña segura');
  } else if (/^MYSQL_PASSWORD\s*=.*$/m.test(current)) {
    el.value = current.replace(/^MYSQL_PASSWORD\s*=.*$/m, `MYSQL_PASSWORD=${pass}`);
    showToast('🎲 MYSQL_PASSWORD actualizado con contraseña segura');
  } else if (/^DB_PASSWORD\s*=.*$/m.test(current)) {
    el.value = current.replace(/^DB_PASSWORD\s*=.*$/m, `DB_PASSWORD=${pass}`);
    showToast('🎲 DB_PASSWORD actualizado con contraseña segura');
  } else {
    el.value = current ? `${current}\nDB_PASSWORD=${pass}` : `DB_PASSWORD=${pass}`;
    showToast('🎲 DB_PASSWORD seguro agregado al .env');
  }
}

function onCloneRepoUrlInput(url) {
  const nameInput = document.getElementById('clone-name');
  if (!nameInput || nameInput.value.trim()) return;
  const match = /\/([^\/]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (match && match[1]) {
    nameInput.value = match[1].replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}

async function autoFetchRepoEnvExample() {
  const repoUrl = (document.getElementById('clone-url')?.value || '').trim();
  const branch = (document.getElementById('clone-branch')?.value || 'main').trim() || 'main';
  const envEl = document.getElementById('clone-env');
  if (!repoUrl) {
    showToast('Primero pega la URL del repositorio Git');
    return;
  }

  // Extraer owner/repo si es GitHub para consultar raw .env.example
  const ghMatch = /github\.com[:/]([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/i.exec(repoUrl);
  if (!ghMatch) {
    injectGeneratedSecret('clone-env', 'JWT_SECRET', 32);
    return;
  }

  const [, owner, repo] = ghMatch;
  const branchesToTry = [branch, 'main', 'master', 'develop'];
  for (const b of branchesToTry) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/.env.example`;
      const resp = await fetch(rawUrl);
      if (resp.ok) {
        let text = (await resp.text()).trim();
        text = text.replace(/^NODE_ENV\s*=\s*development\s*$/m, 'NODE_ENV=production');
        const jwtSecret = generateCryptoHex(32);
        if (/^JWT_SECRET\s*=.*$/m.test(text)) {
          text = text.replace(/^JWT_SECRET\s*=.*$/m, `JWT_SECRET=${jwtSecret}`);
        } else {
          text += `\nJWT_SECRET=${jwtSecret}`;
        }
        if (envEl) envEl.value = text;
        showToast('✨ .env.example cargado del repositorio + JWT_SECRET generado automáticamente');
        return;
      }
    } catch {
      // Intentar siguiente rama
    }
  }

  // Si el repo no tenía .env.example público, al menos generar JWT_SECRET
  injectGeneratedSecret('clone-env', 'JWT_SECRET', 32);
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
