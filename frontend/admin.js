const SUPABASE_URL = 'https://qnrkvnnuyfirrohnmzoe.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Y9O5EuZiuUAZ8l0QybWkLQ_Y4by6uhb';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Ajusta esto si tu backend corre en otro host/puerto.
const BACKEND_URL = 'http://localhost:8001';

function mostrarSeccion(nombre) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${nombre}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === nombre));
  document.querySelector('.sidebar')?.classList.remove('abierta');
  document.querySelector('.sidebar-backdrop')?.classList.remove('visible');
}

async function continuarComoAdmin(usuario) {
  const { data: perfil } = await sb.from('perfiles').select('rol, activo').eq('id', usuario.id).single();

  if (!perfil || perfil.rol !== 'admin') {
    document.getElementById('verificando').classList.add('hidden');
    document.getElementById('mensaje-acceso-denegado').textContent = 'Esta cuenta no tiene rol de administrador.';
    document.getElementById('acceso-denegado').classList.remove('hidden');
    return false;
  }

  if (!perfil.activo) {
    await sb.auth.signOut();
    document.getElementById('verificando').classList.add('hidden');
    document.getElementById('mensaje-acceso-denegado').textContent =
      'Tu cuenta fue desactivada. Contacta a otro administrador si crees que es un error.';
    document.getElementById('acceso-denegado').classList.remove('hidden');
    return false;
  }

  document.getElementById('pantalla-verificando').classList.add('hidden');
  document.getElementById('panel-admin').classList.remove('hidden');
  document.getElementById('sesion-info').textContent = usuario.email;
  cargarUsuarios();
  cargarStats();
  cargarClave();
  cargarPreguntas();
  return true;
}

async function cerrarSesion() {
  await sb.auth.signOut();
  location.href = 'index.html';
}

// El login vive solo en index.html. Aquí solo comprobamos si ya existe
// una sesión (compartida por estar en el mismo origen http://localhost:5500);
// si no hay ninguna, no tiene caso mostrar nada de este panel.
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await continuarComoAdmin(session.user);
  } else {
    location.href = 'index.html';
  }
})();

function badgeRol(rol) {
  const clases = { admin: 'badge-danger', profesor: 'badge-info', alumno: 'badge-muted' };
  return `<span class="badge ${clases[rol] || 'badge-muted'}">${escaparHTML(rol)}</span>`;
}

// Se guardan por id para no meter el nombre dentro del onclick del botón.
let usuariosPorId = {};

async function cargarUsuarios() {
  const { data, error } = await sb.from('perfiles').select('id, nombre_completo, matricula, rol, activo, creado_en').order('creado_en', { ascending: false });
  const tbody = document.querySelector('#tabla-usuarios tbody');
  tbody.innerHTML = '';
  if (error) { console.error(error); return; }
  usuariosPorId = {};
  data.forEach(u => {
    usuariosPorId[u.id] = u;
    const opciones = ['alumno','profesor','admin'].map(r => `<option value="${r}" ${r===u.rol?'selected':''}>${r}</option>`).join('');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${u.nombre_completo ? escaparHTML(u.nombre_completo) : '<span style="color:var(--text-muted)">(sin nombre)</span>'}</td>
      <td>${escaparHTML(u.matricula || '—')}</td>
      <td><select class="rol-select" onchange="cambiarRol('${u.id}', this.value)">${opciones}</select></td>
      <td>${u.activo ? '<span class="badge badge-success">Activa</span>' : '<span class="badge badge-danger">Desactivada</span>'}</td>
      <td style="color:var(--text-muted)">${new Date(u.creado_en).toLocaleDateString()}</td>
      <td class="whitespace-nowrap">
        <button class="btn" onclick="toggleActivoUsuario('${u.id}', ${!u.activo})">${u.activo ? 'Desactivar' : 'Reactivar'}</button>
        <button class="btn btn-danger" onclick="borrarUsuarioPermanente('${u.id}')">Borrar</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function cambiarRol(id, nuevoRol) {
  await sb.from('perfiles').update({ rol: nuevoRol }).eq('id', id);
  cargarStats();
}

async function toggleActivoUsuario(id, nuevoValor) {
  await sb.from('perfiles').update({ activo: nuevoValor }).eq('id', id);
  cargarUsuarios();
}

async function borrarUsuarioPermanente(id) {
  const nombre = usuariosPorId[id]?.nombre_completo || 'este usuario';
  const confirmado = confirm(
    `¿Borrar PERMANENTEMENTE la cuenta de "${nombre}"?\n\n` +
    `Esto elimina también todo su contenido (preguntas, exámenes, calificaciones). ` +
    `No se puede deshacer. Si solo quieres suspenderla temporalmente, usa "Desactivar" en vez de esto.`
  );
  if (!confirmado) return;

  const { data: { session } } = await sb.auth.getSession();
  const resp = await fetch(`${BACKEND_URL}/api/admin/usuarios/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!resp.ok) {
    const detalle = await resp.json().catch(() => ({}));
    alert(detalle.detail || `No se pudo borrar (${resp.status}).`);
    return;
  }

  cargarUsuarios();
  cargarStats();
}

async function cargarStats() {
  const [{ count: usuarios }, { count: profesores }, { count: preguntas }, { count: examenes }] = await Promise.all([
    sb.from('perfiles').select('*', { count: 'exact', head: true }),
    sb.from('perfiles').select('*', { count: 'exact', head: true }).eq('rol', 'profesor'),
    sb.from('preguntas').select('*', { count: 'exact', head: true }),
    sb.from('examenes').select('*', { count: 'exact', head: true }),
  ]);
  document.getElementById('stat-usuarios').textContent = usuarios ?? '—';
  document.getElementById('stat-profesores').textContent = profesores ?? '—';
  document.getElementById('stat-preguntas').textContent = preguntas ?? '—';
  document.getElementById('stat-examenes').textContent = examenes ?? '—';
}

async function cargarClave() {
  const { data, error } = await sb.from('configuracion_sistema').select('valor').eq('clave', 'clave_maestro').single();
  if (!error && data) document.getElementById('input-clave').value = data.valor;
}

async function guardarClave() {
  const valor = document.getElementById('input-clave').value;
  const { error } = await sb.from('configuracion_sistema').update({ valor }).eq('clave', 'clave_maestro');
  const msgEl = document.getElementById('clave-msg');
  msgEl.textContent = error ? error.message : 'Clave actualizada.';
  msgEl.style.color = error ? 'var(--danger)' : 'var(--success)';
  msgEl.classList.remove('hidden');
}

function badgeDificultad(d) {
  const clases = { facil: 'badge-success', media: 'badge-info', dificil: 'badge-danger' };
  return `<span class="badge ${clases[d] || 'badge-muted'}">${escaparHTML(d)}</span>`;
}

let bancoGlobalCompleto = [];
let profesorActivo = null; // null = todos

async function cargarPreguntas() {
  const { data, error } = await sb
    .from('preguntas')
    .select('id, pregunta, categoria, dificultad, activo, creado_por, perfiles(nombre_completo)')
    .order('creado_en', { ascending: false });

  if (error) { console.error(error); return; }

  bancoGlobalCompleto = data;
  profesorActivo = null;
  pintarProfesores();
  pintarTablaPreguntasGlobal();
}

function pintarProfesores() {
  const grupos = {}; // creado_por -> { nombre, count }
  bancoGlobalCompleto.forEach(p => {
    const id = p.creado_por;
    const nombre = p.perfiles?.nombre_completo || '(desconocido)';
    if (!grupos[id]) grupos[id] = { nombre, count: 0 };
    grupos[id].count++;
  });

  const grid = document.getElementById('grid-profesores');
  grid.innerHTML = '';
  if (Object.keys(grupos).length === 0) return;

  const total = bancoGlobalCompleto.length;
  grid.innerHTML += `
    <button class="cat-card ${profesorActivo === null ? 'activa' : ''}" onclick="filtrarPorProfesor(null)">
      <p class="cat-nombre">Todos</p>
      <p class="cat-conteo">${total} pregunta${total === 1 ? '' : 's'}</p>
    </button>`;

  Object.entries(grupos)
    .sort((a, b) => a[1].nombre.localeCompare(b[1].nombre))
    .forEach(([id, g]) => {
      grid.innerHTML += `
        <button class="cat-card ${profesorActivo === id ? 'activa' : ''}" onclick="filtrarPorProfesor('${id}')">
          <p class="cat-nombre" style="text-transform:none;">${escaparHTML(g.nombre)}</p>
          <p class="cat-conteo">${g.count} pregunta${g.count === 1 ? '' : 's'}</p>
        </button>`;
    });
}

function filtrarPorProfesor(id) {
  profesorActivo = id;
  pintarProfesores();
  pintarTablaPreguntasGlobal();
}

function pintarTablaPreguntasGlobal() {
  const tbody = document.querySelector('#tabla-preguntas-global tbody');
  tbody.innerHTML = '';
  const preguntas = profesorActivo ? bancoGlobalCompleto.filter(p => p.creado_por === profesorActivo) : bancoGlobalCompleto;

  preguntas.forEach(p => {
    const tr = document.createElement('tr');
    if (!p.activo) tr.className = 'inactivo';
    const dueño = p.perfiles?.nombre_completo || '(desconocido)';
    tr.innerHTML = `<td>${escaparHTML(p.pregunta)}<br><span class="text-xs" style="color:var(--text-muted)">de ${escaparHTML(dueño)}</span></td>
      <td>${escaparHTML(p.categoria)}</td>
      <td>${badgeDificultad(p.dificultad)}</td>
      <td>${p.activo ? '<span class="badge badge-success">Activa</span>' : '<span class="badge badge-danger">Desactivada</span>'}</td>
      <td class="whitespace-nowrap">
        <button class="btn" onclick="toggleActivo('${p.id}', ${!p.activo})">${p.activo ? 'Desactivar' : 'Reactivar'}</button>
        <button class="btn btn-danger" onclick="borrarPreguntaGlobal('${p.id}')">Borrar</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function toggleActivo(id, nuevoValor) {
  await sb.from('preguntas').update({ activo: nuevoValor }).eq('id', id);
  cargarPreguntas();
}

async function borrarPreguntaGlobal(id) {
  const pregunta = bancoGlobalCompleto.find(p => p.id === id);
  const confirmado = confirm(
    `¿Borrar esta pregunta${pregunta?.perfiles?.nombre_completo ? ' de ' + pregunta.perfiles.nombre_completo : ''}?\n\n"${pregunta ? pregunta.pregunta : ''}"\n\nNo se puede deshacer.`
  );
  if (!confirmado) return;

  await sb.from('preguntas').delete().eq('id', id);
  cargarPreguntas();
  cargarStats();
}