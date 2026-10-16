async function loadAuditLogs() {
  const data = await apiFetch('/api/audit');
  const list = document.getElementById('audit-list');
  if (!list) return;
  list.innerHTML =
    (data.logs || [])
      .map(
        (l) => `
      <div class="flex flex-wrap items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5">
        <div class="flex items-center gap-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
            l.status === 'ok' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
          }">${l.action}</span>
          <span class="font-mono text-white">${l.target}</span>
        </div>
        <div class="text-slate-400 font-mono text-[11px]">
          IP: ${l.ip} • ${new Date(l.timestamp).toLocaleString()}
        </div>
      </div>`
      )
      .join('') || '<div class="text-slate-500">Sin eventos registrados todavía.</div>';
}
