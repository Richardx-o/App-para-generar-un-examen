const SUPABASE_URL = 'https://qnrkvnnuyfirrohnmzoe.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Y9O5EuZiuUAZ8l0QybWkLQ_Y4by6uhb';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Ajusta esto si tu backend corre en otro host/puerto.
const BACKEND_URL = 'http://localhost:8001';

let usuarioActual = null;

function mostrarSeccion(nombre) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${nombre}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === nombre));
  document.querySelector('.sidebar')?.classList.remove('abierta');
  document.querySelector('.sidebar-backdrop')?.classList.remove('visible');
}

async function continuarComoMaestro(usuario) {
  const { data: perfil, error: errorPerfil } = await sb.from('perfiles').select('rol, nombre_completo').eq('id', usuario.id).single();

  if (errorPerfil || !perfil || (perfil.rol !== 'profesor' && perfil.rol !== 'admin')) {
    document.getElementById('verificando').classList.add('hidden');
    document.getElementById('acceso-denegado').classList.remove('hidden');
    return;
  }

  usuarioActual = usuario;
  document.getElementById('pantalla-verificando').classList.add('hidden');
  document.getElementById('panel-maestro').classList.remove('hidden');
  document.getElementById('sesion-info').textContent = usuario.email;
  cargarBanco();
  cargarHistorial();
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
    await continuarComoMaestro(session.user);
  } else {
    location.href = 'index.html';
  }
})();

function badgeDificultad(d) {
  const clases = { facil: 'badge-success', media: 'badge-info', dificil: 'badge-danger' };
  return `<span class="badge ${clases[d] || 'badge-muted'}">${d}</span>`;
}

let bancoCompleto = [];
let categoriaActiva = null; // null = todas

async function cargarBanco() {
  const { data, error } = await sb.from('preguntas').select('*').eq('creado_por', usuarioActual.id).order('creado_en', { ascending: false });
  document.getElementById('contador-banco').textContent = data ? data.length : 0;
  if (error) { console.error(error); return; }

  bancoCompleto = data;
  categoriaActiva = null;
  pintarCategorias();
  pintarTablaPreguntas();
}

function pintarCategorias() {
  const conteos = {};
  bancoCompleto.forEach(p => { conteos[p.categoria] = (conteos[p.categoria] || 0) + 1; });
  const categorias = Object.keys(conteos).sort();

  const grid = document.getElementById('grid-categorias');
  grid.innerHTML = '';

  if (categorias.length === 0) return; // banco vacío: no hay nada que agrupar todavía

  // Tarjeta "Todas" para quitar el filtro
  const total = bancoCompleto.length;
  grid.innerHTML += `
    <button class="cat-card ${categoriaActiva === null ? 'activa' : ''}" onclick="filtrarPorCategoria(null)">
      <p class="cat-nombre">Todas</p>
      <p class="cat-conteo">${total} pregunta${total === 1 ? '' : 's'}</p>
    </button>`;

  categorias.forEach(cat => {
    grid.innerHTML += `
      <button class="cat-card ${categoriaActiva === cat ? 'activa' : ''}" onclick="filtrarPorCategoria('${cat}')">
        <p class="cat-nombre">${cat}</p>
        <p class="cat-conteo">${conteos[cat]} pregunta${conteos[cat] === 1 ? '' : 's'}</p>
      </button>`;
  });
}

function filtrarPorCategoria(categoria) {
  categoriaActiva = categoria;
  pintarCategorias();
  pintarTablaPreguntas();
}

function pintarTablaPreguntas() {
  const tbody = document.querySelector('#tabla-preguntas tbody');
  tbody.innerHTML = '';
  const preguntas = categoriaActiva ? bancoCompleto.filter(p => p.categoria === categoriaActiva) : bancoCompleto;

  preguntas.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.pregunta}</td>
      <td><span class="badge badge-muted">${p.respuesta_correcta}</span></td>
      <td>${badgeDificultad(p.dificultad)}</td>
      <td>${p.categoria}</td>
      <td><button class="btn btn-danger" onclick="borrarPregunta('${p.id}')">Borrar</button></td>`;
    tbody.appendChild(tr);
  });
}

async function borrarPregunta(id) {
  await sb.from('preguntas').delete().eq('id', id);
  cargarBanco();
}

document.getElementById('form-pregunta').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('pregunta-error');
  errorEl.classList.add('hidden');

  const { error } = await sb.from('preguntas').insert({
    pregunta: document.getElementById('p-pregunta').value,
    opcion_a: document.getElementById('p-a').value,
    opcion_b: document.getElementById('p-b').value,
    opcion_c: document.getElementById('p-c').value,
    opcion_d: document.getElementById('p-d').value,
    respuesta_correcta: document.getElementById('p-correcta').value,
    dificultad: document.getElementById('p-dificultad').value,
    categoria: document.getElementById('p-categoria').value,
    creado_por: usuarioActual.id,
  });

  if (error) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); return; }
  e.target.reset();
  document.getElementById('p-categoria').value = 'circuitos';
  cargarBanco();
});

document.getElementById('form-examen').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('examen-error');
  const exitoEl = document.getElementById('examen-exito');
  errorEl.classList.add('hidden');
  exitoEl.classList.add('hidden');

  const categoria = document.getElementById('e-categoria').value.trim() || null;
  const dificultad = document.getElementById('e-dificultad').value || null;
  const cantidad = parseInt(document.getElementById('e-cantidad').value, 10);

  const { data: examenId, error } = await sb.rpc('crear_examen_completo', {
    p_titulo: document.getElementById('e-titulo').value,
    p_categoria: categoria,
    p_dificultad: dificultad,
    p_cantidad: cantidad,
  });

  if (error) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); return; }

  const { data: examen } = await sb.from('examenes').select('codigo_acceso').eq('id', examenId).single();
  exitoEl.innerHTML = `Examen creado. Código de acceso para tus alumnos: <span class="badge badge-success" style="font-size:14px;">${examen.codigo_acceso}</span>`;
  exitoEl.classList.remove('hidden');
  cargarHistorial();
});

async function descargarExamenPDF() {
  const errorEl = document.getElementById('examen-error');
  errorEl.classList.add('hidden');

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { errorEl.textContent = 'Sesión expirada, vuelve a iniciar sesión.'; errorEl.classList.remove('hidden'); return; }

  const categoria = document.getElementById('e-categoria').value.trim();
  const dificultad = document.getElementById('e-dificultad').value;
  const cantidad = document.getElementById('e-cantidad').value;

  const params = new URLSearchParams({ cantidad });
  if (categoria) params.set('categoria', categoria);
  if (dificultad) params.set('dificultad', dificultad);

  const resp = await fetch(`${BACKEND_URL}/api/examenes/generar?${params}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!resp.ok) {
    const detalle = await resp.json().catch(() => ({}));
    errorEl.textContent = detalle.detail || `Error al generar el PDF (${resp.status}).`;
    errorEl.classList.remove('hidden');
    return;
  }

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'examen.zip';
  a.click();
  URL.revokeObjectURL(url);
}

async function cargarHistorial() {
  const { data: examenes, error } = await sb.from('examenes').select('*').eq('creado_por', usuarioActual.id).order('creado_en', { ascending: false });
  const contenedor = document.getElementById('lista-historial');
  contenedor.innerHTML = '';
  if (error) { console.error(error); return; }

  document.getElementById('contador-examenes').textContent = examenes.length;

  for (const ex of examenes) {
    // Trae nombre y matrícula de cada alumno vía la relación con perfiles
    // (permitido gracias a la política "Profesores ven perfiles de sus alumnos").
    const { data: intentos } = await sb
      .from('intentos_examen')
      .select('calificacion, estado, entregado_en, perfiles(nombre_completo, matricula)')
      .eq('examen_id', ex.id)
      .eq('estado', 'entregado')
      .order('entregado_en', { ascending: false });

    const lista = intentos || [];
    const total = lista.length;
    const promedio = total > 0 ? Math.round(lista.reduce((s, i) => s + Number(i.calificacion), 0) / total) : null;

    const filasAlumnos = lista.map(i => `
      <tr>
        <td>${i.perfiles?.nombre_completo || '<span style="color:var(--text-muted)">(sin nombre)</span>'}</td>
        <td>${i.perfiles?.matricula || '—'}</td>
        <td>${Number(i.calificacion) >= 70
              ? `<span class="badge badge-success">${i.calificacion}%</span>`
              : `<span class="badge badge-danger">${i.calificacion}%</span>`}</td>
        <td style="color:var(--text-muted)">${new Date(i.entregado_en).toLocaleString()}</td>
      </tr>`).join('');

    const tarjeta = document.createElement('div');
    tarjeta.className = 'card overflow-hidden';
    tarjeta.innerHTML = `
      <button class="w-full flex items-center justify-between gap-3 p-4 text-left" style="background:transparent; border:none; cursor:pointer;" onclick="this.nextElementSibling.classList.toggle('hidden')">
        <div>
          <p class="font-medium">${ex.titulo}</p>
          <p class="text-xs mt-0.5" style="color:var(--text-muted)">
            Código <span class="badge badge-muted">${ex.codigo_acceso}</span>
            · ${new Date(ex.creado_en).toLocaleDateString()}
          </p>
        </div>
        <div class="text-right shrink-0">
          <p class="text-sm">${total} entregado${total === 1 ? '' : 's'}</p>
          <p class="text-xs" style="color:var(--text-muted)">${promedio !== null ? 'Promedio ' + promedio + '%' : 'Sin calificar aún'}</p>
        </div>
      </button>
      <div class="hidden border-t" style="border-color:var(--border);">
        ${total === 0
          ? `<p class="p-4 text-sm" style="color:var(--text-muted)">Nadie ha entregado este examen todavía.</p>`
          : `<table>
              <thead><tr><th>Alumno</th><th>Matrícula</th><th>Calificación</th><th>Entregado</th></tr></thead>
              <tbody>${filasAlumnos}</tbody>
            </table>`}
      </div>`;
    contenedor.appendChild(tarjeta);
  }
}