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
  const { data: perfil, error: errorPerfil } = await sb.from('perfiles').select('rol, nombre_completo, activo').eq('id', usuario.id).single();

  if (errorPerfil || !perfil || (perfil.rol !== 'profesor' && perfil.rol !== 'admin')) {
    document.getElementById('verificando').classList.add('hidden');
    document.getElementById('mensaje-acceso-denegado').textContent = 'Esta cuenta no tiene rol de maestro.';
    document.getElementById('acceso-denegado').classList.remove('hidden');
    return;
  }

  if (!perfil.activo) {
    // No basta con negar el acceso: si lo dejamos con sesión abierta,
    // se queda viendo esta pantalla pero técnicamente sigue logueado.
    await sb.auth.signOut();
    document.getElementById('verificando').classList.add('hidden');
    document.getElementById('mensaje-acceso-denegado').textContent =
      'Tu cuenta fue desactivada. Contacta al administrador si crees que es un error.';
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
  return `<span class="badge ${clases[d] || 'badge-muted'}">${escaparHTML(d)}</span>`;
}

let bancoCompleto = [];
let categoriaActiva = null; // null = todas
// Lista de categorías en el orden en que se pintan; los botones usan su
// posición en vez del nombre, así un apóstrofo en la categoría no rompe el onclick.
let categoriasOrdenadas = [];

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
  categoriasOrdenadas = categorias;

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

  categorias.forEach((cat, i) => {
    grid.innerHTML += `
      <button class="cat-card ${categoriaActiva === cat ? 'activa' : ''}" onclick="filtrarPorCategoria(categoriasOrdenadas[${i}])">
        <p class="cat-nombre">${escaparHTML(cat)}</p>
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
    tr.innerHTML = `<td>${escaparHTML(p.pregunta)}</td>
      <td><span class="badge badge-muted">${p.respuesta_correcta}</span></td>
      <td>${badgeDificultad(p.dificultad)}</td>
      <td>${escaparHTML(p.categoria)}</td>
      <td class="whitespace-nowrap">
        <button class="btn" onclick="editarPregunta('${p.id}')">Editar</button>
        <button class="btn btn-danger" onclick="borrarPregunta('${p.id}')">Borrar</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function borrarPregunta(id) {
  const pregunta = bancoCompleto.find(p => p.id === id);
  const confirmado = confirm(
    `¿Borrar esta pregunta?\n\n"${pregunta ? pregunta.pregunta : ''}"\n\nNo se puede deshacer.`
  );
  if (!confirmado) return;

  await sb.from('preguntas').delete().eq('id', id);
  cargarBanco();
}

let preguntaEditandoId = null; // null = el formulario está en modo "agregar"

function editarPregunta(id) {
  const p = bancoCompleto.find(x => x.id === id);
  if (!p) return;

  preguntaEditandoId = id;
  document.getElementById('p-pregunta').value = p.pregunta;
  document.getElementById('p-a').value = p.opcion_a;
  document.getElementById('p-b').value = p.opcion_b;
  document.getElementById('p-c').value = p.opcion_c;
  document.getElementById('p-d').value = p.opcion_d;
  document.getElementById('p-correcta').value = p.respuesta_correcta;
  document.getElementById('p-dificultad').value = p.dificultad;
  document.getElementById('p-categoria').value = p.categoria;

  document.getElementById('titulo-form-pregunta').textContent = 'Editando pregunta';
  document.getElementById('btn-guardar-pregunta').textContent = 'Guardar cambios';
  document.getElementById('btn-cancelar-edicion').classList.remove('hidden');
  document.getElementById('form-pregunta').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelarEdicionPregunta() {
  preguntaEditandoId = null;
  document.getElementById('form-pregunta').reset();
  document.getElementById('p-categoria').value = 'circuitos';
  document.getElementById('titulo-form-pregunta').textContent = 'Agregar pregunta';
  document.getElementById('btn-guardar-pregunta').textContent = 'Agregar a mi banco';
  document.getElementById('btn-cancelar-edicion').classList.add('hidden');
}

document.getElementById('form-pregunta').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('pregunta-error');
  errorEl.classList.add('hidden');

  const datos = {
    pregunta: document.getElementById('p-pregunta').value,
    opcion_a: document.getElementById('p-a').value,
    opcion_b: document.getElementById('p-b').value,
    opcion_c: document.getElementById('p-c').value,
    opcion_d: document.getElementById('p-d').value,
    respuesta_correcta: document.getElementById('p-correcta').value,
    dificultad: document.getElementById('p-dificultad').value,
    categoria: document.getElementById('p-categoria').value,
  };

  // Ojo: si esta pregunta ya se usó en un examen anterior, ese examen guardó
  // su propia copia congelada en examen_preguntas — editarla aquí NO cambia
  // exámenes ya generados, solo afecta a los que se generen de ahora en adelante.
  const { error } = preguntaEditandoId
    ? await sb.from('preguntas').update(datos).eq('id', preguntaEditandoId)
    : await sb.from('preguntas').insert({ ...datos, creado_por: usuarioActual.id });

  if (error) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); return; }

  cancelarEdicionPregunta();
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
  exitoEl.innerHTML = `Examen creado. Código de acceso para tus alumnos: <span class="badge badge-success" style="font-size:14px;">${escaparHTML(examen.codigo_acceso)}</span>`;
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
        <td>${i.perfiles?.nombre_completo ? escaparHTML(i.perfiles.nombre_completo) : '<span style="color:var(--text-muted)">(sin nombre)</span>'}</td>
        <td>${escaparHTML(i.perfiles?.matricula || '—')}</td>
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
          <p class="font-medium">${escaparHTML(ex.titulo)}</p>
          <p class="text-xs mt-0.5" style="color:var(--text-muted)">
            Código <span class="badge badge-muted">${escaparHTML(ex.codigo_acceso)}</span>
            · ${new Date(ex.creado_en).toLocaleDateString()}
          </p>
        </div>
        <div class="text-right shrink-0">
          <p class="text-sm">${total} entregado${total === 1 ? '' : 's'}</p>
          <p class="text-xs" style="color:var(--text-muted)">${promedio !== null ? 'Promedio ' + promedio + '%' : 'Sin calificar aún'}</p>
        </div>
      </button>
      <div class="hidden border-t" style="border-color:var(--border);">
        <div class="flex items-center justify-between gap-3 p-4" style="background:var(--surface-2);">
          <span class="badge ${ex.cerrado ? 'badge-danger' : 'badge-success'}">${ex.cerrado ? 'Cerrado' : 'Abierto'}</span>
          <button class="btn" onclick="toggleCerradoExamen('${ex.id}', ${!ex.cerrado})">
            ${ex.cerrado ? 'Reabrir examen' : 'Cerrar examen'}
          </button>
        </div>
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

async function toggleCerradoExamen(examenId, nuevoValor) {
  await sb.from('examenes').update({ cerrado: nuevoValor }).eq('id', examenId);
  cargarHistorial();
}