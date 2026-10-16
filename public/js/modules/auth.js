async function submitLoginForm(e) {
  e.preventDefault();
  const errBox = document.getElementById('login-error');
  if (errBox) errBox.classList.add('hidden');
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('login-user').value.trim(),
        password: document.getElementById('login-pass').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error de autenticación');
    authToken = data.token;
    localStorage.setItem('alpanel_token', authToken);
    localStorage.removeItem('sm_panel_token');
    await initApp();
  } catch (err) {
    if (errBox) {
      errBox.innerText = err.message;
      errBox.classList.remove('hidden');
    }
  }
}

function logout() {
  authToken = '';
  currentUser = null;
  localStorage.removeItem('alpanel_token');
  localStorage.removeItem('sm_panel_token');
  if (socket) socket.disconnect();
  const appView = document.getElementById('app-view');
  const loginView = document.getElementById('login-view');
  if (appView) appView.classList.add('hidden');
  if (loginView) loginView.classList.remove('hidden');
}
