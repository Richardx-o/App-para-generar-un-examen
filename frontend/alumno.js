const SUPABASE_URL = 'https://qnrkvnnuyfirrohnmzoe.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Y9O5EuZiuUAZ8l0QybWkLQ_Y4by6uhb';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Ajusta esto si tu backend corre en otro host/puerto.
const BACKEND_URL = 'http://localhost:8001';

let usuarioActual = null;
let intentoActual = null;
let preguntasActuales = [];

function continuarComoAlumno(usuario) {
  usuarioActual = usuario;
  document.getElementById('pantalla-verificando').classList.add('hidden');
  document.getElementById('panel-alumno').classList.remove('hidden');
  document.getElementById('sesion-info').textContent = usuario.email;
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
    continuarComoAlumno(session.user);
  } else {
    location.href = 'index.html';
  }
})();

// ---- Navegación entre las 3 vistas principales ----
function ocultarTodasLasTarjetas() {
  ['tarjeta-codigo', 'tarjeta-examen', 'tarjeta-resultado', 'tarjeta-mis-resultados']
    .forEach(id => document.getElementById(id).classList.add('hidden'));
}

function mostrarPantallaCodigo() {
  ocultarTodasLasTarjetas();
  document.getElementById('tarjeta-codigo').classList.remove('hidden');
}

async function mostrarMisResultados() {
  ocultarTodasLasTarjetas();
  document.getElementById('tarjeta-mis-resultados').classList.remove('hidden');
  await cargarMisResultados();
}

async function cargarMisResultados() {
  const contenedor = document.getElementById('lista-mis-resultados');
  contenedor.innerHTML = `<p class="text-sm" style="color:var(--text-muted)">Cargando…</p>`;

  const { data, error } = await sb
    .from('intentos_examen')
    .select('id, calificacion, entregado_en, examenes(titulo)')
    .eq('alumno_id', usuarioActual.id)
    .eq('estado', 'entregado')
    .order('entregado_en', { ascending: false });

  if (error) { contenedor.innerHTML = `<p class="text-sm" style="color:var(--danger)">${error.message}</p>`; return; }

  if (!data || data.length === 0) {
    contenedor.innerHTML = `<p class="text-sm" style="color:var(--text-muted)">Todavía no has entregado ningún examen.</p>`;
    return;
  }

  contenedor.innerHTML = '';
  data.forEach(i => {
    const aprobado = Number(i.calificacion) >= 70;
    const div = document.createElement('div');
    div.className = 'card p-4 flex items-center justify-between gap-3 flex-wrap';
    div.innerHTML = `
      <div>
        <p class="font-medium">${i.examenes?.titulo || 'Examen'}</p>
        <p class="text-xs mt-0.5" style="color:var(--text-muted)">${new Date(i.entregado_en).toLocaleString()}</p>
      </div>
      <div class="flex items-center gap-3">
        <span class="badge ${aprobado ? 'badge-success' : 'badge-danger'}">${i.calificacion}%</span>
        <button class="btn btn-accent" onclick="descargarResultado('${i.id}')">Descargar PDF</button>
      </div>`;
    contenedor.appendChild(div);
  });
}

async function mostrarResultado(intentoId, calificacion) {
  intentoActual = intentoId;
  ocultarTodasLasTarjetas();
  document.getElementById('tarjeta-resultado').classList.remove('hidden');
  document.getElementById('res-calificacion').textContent = calificacion;

  const aroEl = document.getElementById('res-aro');
  const aprobado = calificacion >= 70;
  aroEl.style.color = aprobado ? 'var(--success)' : 'var(--danger)';
  document.getElementById('res-veredicto').textContent = aprobado ? 'Aprobado' : 'No aprobado';
  document.getElementById('res-veredicto').className = `badge ${aprobado ? 'badge-success' : 'badge-danger'}`;
}

async function unirseAExamen() {
  const codigo = document.getElementById('input-codigo').value.trim();
  const errorEl = document.getElementById('codigo-error');
  errorEl.classList.add('hidden');

  const { data: intentoId, error } = await sb.rpc('unirse_a_examen', { p_codigo_acceso: codigo });
  if (error) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); return; }
  intentoActual = intentoId;

  const { data: intento } = await sb.from('intentos_examen').select('examen_id, estado, calificacion').eq('id', intentoId).single();
  if (intento.estado === 'entregado') {
    // Ya lo había entregado antes: en vez de bloquearlo con un error,
    // le mostramos directo su resultado (y puede volver a descargar el PDF).
    await mostrarResultado(intentoId, intento.calificacion);
    return;
  }

  const { data: examen } = await sb.from('examenes').select('titulo').eq('id', intento.examen_id).single();
  const { data: preguntas } = await sb.from('examen_preguntas').select('*').eq('examen_id', intento.examen_id).order('orden');
  preguntasActuales = preguntas;

  ocultarTodasLasTarjetas();
  document.getElementById('tarjeta-examen').classList.remove('hidden');
  document.getElementById('titulo-examen').textContent = examen.titulo;
  document.getElementById('contador-preguntas').textContent = `${preguntas.length} pregunta${preguntas.length === 1 ? '' : 's'}`;

  const form = document.getElementById('form-respuestas');
  form.innerHTML = '';
  preguntas.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'card p-4 mb-3';
    let html = `<p class="font-medium mb-3">${i+1}. ${p.pregunta_texto}</p>`;
    ['A','B','C','D'].forEach(letra => {
      const opcion = p[`opcion_${letra.toLowerCase()}`];
      html += `
        <label class="flex items-center gap-2 py-1.5 text-sm cursor-pointer">
          <input type="radio" name="pregunta-${p.id}" value="${letra}" style="width:auto;">
          <span>${letra}) ${opcion}</span>
        </label>`;
    });
    div.innerHTML = html;
    form.appendChild(div);
  });
}

async function entregarExamen() {
  const errorEl = document.getElementById('entrega-error');
  errorEl.classList.add('hidden');

  const respuestas = preguntasActuales.map(p => {
    const seleccion = document.querySelector(`input[name="pregunta-${p.id}"]:checked`);
    return seleccion ? { intento_id: intentoActual, examen_pregunta_id: p.id, letra_seleccionada: seleccion.value } : null;
  }).filter(r => r !== null);

  if (respuestas.length < preguntasActuales.length) {
    errorEl.textContent = 'Contesta todas las preguntas antes de entregar.';
    errorEl.classList.remove('hidden');
    return;
  }

  const { error: errorInsert } = await sb.from('respuestas_alumno').upsert(respuestas, { onConflict: 'intento_id,examen_pregunta_id' });
  if (errorInsert) { errorEl.textContent = errorInsert.message; errorEl.classList.remove('hidden'); return; }

  const { data: calificacion, error: errorCalificar } = await sb.rpc('calificar_intento', { p_intento_id: intentoActual });
  if (errorCalificar) { errorEl.textContent = errorCalificar.message; errorEl.classList.remove('hidden'); return; }

  await mostrarResultado(intentoActual, calificacion);
}

async function descargarResultado(intentoId) {
  // Si se llama desde el botón de la tarjeta de resultado (sin argumento),
  // usa el intento que está en pantalla; si se llama desde "Mis resultados",
  // viene con el id específico de esa fila.
  const id = intentoId || intentoActual;
  const errorEl = document.getElementById('descarga-error');
  if (errorEl) errorEl.classList.add('hidden');

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { if (errorEl) { errorEl.textContent = 'Sesión expirada, vuelve a iniciar sesión.'; errorEl.classList.remove('hidden'); } return; }

  const resp = await fetch(`${BACKEND_URL}/api/examenes/resultado/${id}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!resp.ok) {
    const detalle = await resp.json().catch(() => ({}));
    const mensaje = detalle.detail || `Error al generar el PDF (${resp.status}).`;
    if (errorEl) { errorEl.textContent = mensaje; errorEl.classList.remove('hidden'); } else { alert(mensaje); }
    return;
  }

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'resultado.pdf';
  a.click();
  URL.revokeObjectURL(url);
}