// Se carga ANTES de que se pinte el <body>, así que aplica el tema
// guardado de inmediato — sin esto, se vería un parpadeo del tema
// oscuro por defecto antes de cambiar al claro.
(function () {
  if (localStorage.getItem('tema') === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();

const ICONO_SOL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const ICONO_LUNA = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

function alternarTema() {
  const esLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (esLight) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('tema', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('tema', 'light');
  }
  pintarIconoTema();
}

function pintarIconoTema() {
  const esLight = document.documentElement.getAttribute('data-theme') === 'light';
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.innerHTML = esLight ? ICONO_LUNA : ICONO_SOL;
    btn.setAttribute('aria-label', esLight ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  });
}

document.addEventListener('DOMContentLoaded', pintarIconoTema);

// ---- Sidebar móvil (cajón deslizable) ----
function toggleSidebarMovil() {
  document.querySelector('.sidebar')?.classList.toggle('abierta');
  document.querySelector('.sidebar-backdrop')?.classList.toggle('visible');
}
