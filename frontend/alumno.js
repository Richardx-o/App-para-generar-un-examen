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

async function unirseAExamen() {
  const codigo = document.getElementById('input-codigo').value.trim();
  const errorEl = document.getElementById('codigo-error');
  errorEl.classList.add('hidden');

  const { data: intentoId, error } = await sb.rpc('unirse_a_examen', { p_codigo_acceso: codigo });
  if (error) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); return; }
  intentoActual = intentoId;

  const { data: intento } = await sb.from('intentos_examen').select('examen_id, estado').eq('id', intentoId).single();
  if (intento.estado === 'entregado') {
    errorEl.textContent = 'Ya entregaste este examen anteriormente.';
    errorEl.classList.remove('hidden');
    return;
  }

  const { data: examen } = await sb.from('examenes').select('titulo').eq('id', intento.examen_id).single();
  const { data: preguntas } = await sb.from('examen_preguntas').select('*').eq('examen_id', intento.examen_id).order('orden');
  preguntasActuales = preguntas;

  document.getElementById('tarjeta-codigo').classList.add('hidden');
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

  document.getElementById('tarjeta-examen').classList.add('hidden');
  document.getElementById('tarjeta-resultado').classList.remove('hidden');
  document.getElementById('res-calificacion').textContent = calificacion;

  const aroEl = document.getElementById('res-aro');
  const aprobado = calificacion >= 70;
  aroEl.style.color = aprobado ? 'var(--success)' : 'var(--danger)';
  document.getElementById('res-veredicto').textContent = aprobado ? 'Aprobado' : 'No aprobado';
  document.getElementById('res-veredicto').className = `badge ${aprobado ? 'badge-success' : 'badge-danger'}`;
}

async function descargarResultado() {
  const errorEl = document.getElementById('descarga-error');
  errorEl.classList.add('hidden');

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { errorEl.textContent = 'Sesión expirada, vuelve a iniciar sesión.'; errorEl.classList.remove('hidden'); return; }

  const resp = await fetch(`${BACKEND_URL}/api/examenes/resultado/${intentoActual}`, {
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
  a.download = 'resultado.pdf';
  a.click();
  URL.revokeObjectURL(url);
}
