const SUPABASE_URL = 'https://qnrkvnnuyfirrohnmzoe.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Y9O5EuZiuUAZ8l0QybWkLQ_Y4by6uhb';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const PANEL_POR_ROL = {
  profesor: 'maestro_real.html',
  admin: 'admin.html',
  alumno: 'alumno_real.html',
};

const BADGE_POR_ROL = {
  admin: 'badge-danger',
  profesor: 'badge-info',
  alumno: 'badge-muted',
};

const TEXTO_HEADER_POR_ROL = {
  admin: 'Administrador',
  profesor: 'Profesor',
  alumno: 'Alumno',
};

let usuarioActual = null;

function iniciales(nombre, correo) {
  const base = (nombre || correo || '?').trim();
  const partes = base.split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

async function cargarPerfil(usuario) {
  usuarioActual = usuario;

  const { data: perfil, error } = await sb
    .from('perfiles')
    .select('nombre_completo, rol, matricula')
    .eq('id', usuario.id)
    .single();

  document.getElementById('pantalla-verificando').classList.add('hidden');
  document.getElementById('pagina-perfil').classList.remove('hidden');

  if (error || !perfil) {
    document.getElementById('guardar-error').textContent = 'No se pudo cargar tu perfil.';
    document.getElementById('guardar-error').classList.remove('hidden');
    return;
  }

  document.getElementById('header-rol').textContent = TEXTO_HEADER_POR_ROL[perfil.rol] || 'Mi cuenta';
  document.getElementById('avatar-iniciales').textContent = iniciales(perfil.nombre_completo, usuario.email);
  document.getElementById('nombre-mostrado').textContent = perfil.nombre_completo || usuario.email;
  document.getElementById('correo-mostrado').textContent = usuario.email;
  document.getElementById('badge-rol').textContent = perfil.rol;
  document.getElementById('badge-rol').className = `badge ${BADGE_POR_ROL[perfil.rol] || 'badge-muted'} mb-3 inline-block`;

  document.getElementById('p-correo').value = usuario.email;
  document.getElementById('p-rol').value = perfil.rol;
  document.getElementById('p-nombre').value = perfil.nombre_completo || '';
  document.getElementById('p-matricula').value = perfil.matricula || '';

  const linkPanel = document.getElementById('link-volver-panel');
  if (PANEL_POR_ROL[perfil.rol]) {
    linkPanel.href = PANEL_POR_ROL[perfil.rol];
  } else {
    linkPanel.classList.add('hidden');
  }

  document.getElementById('tarjeta-perfil').classList.remove('hidden');
}

document.getElementById('form-perfil').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('guardar-error');
  const exitoEl = document.getElementById('guardar-exito');
  errorEl.classList.add('hidden');
  exitoEl.classList.add('hidden');

  const nombreNuevo = document.getElementById('p-nombre').value.trim();

  const { error } = await sb.from('perfiles').update({
    nombre_completo: nombreNuevo,
    matricula: document.getElementById('p-matricula').value.trim() || null,
  }).eq('id', usuarioActual.id);

  if (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove('hidden');
    return;
  }

  document.getElementById('avatar-iniciales').textContent = iniciales(nombreNuevo, usuarioActual.email);
  document.getElementById('nombre-mostrado').textContent = nombreNuevo || usuarioActual.email;
  exitoEl.classList.remove('hidden');
});

// El login vive solo en index.html.
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await cargarPerfil(session.user);
  } else {
    location.href = 'index.html';
  }
})();