// Ventana "Completa tu perfil": aparece al entrar a cualquier panel cuando
// al usuario le falta información básica (nombre, y matrícula si es alumno).
//
// Sin esto, un usuario recién registrado no tenía ninguna señal visual de que
// debía llenar su perfil, y el admin lo veía como "(sin nombre)" indefinidamente.
//
// Depende de la variable global `sb` (cliente de Supabase), que define cada
// panel (admin.js, maestro.js, alumno.js) antes de llamar a esta función.

async function revisarPerfilIncompleto(usuario) {
  // "Más tarde" la oculta solo durante esta sesión del navegador: al volver
  // a iniciar sesión, si sigue incompleto, vuelve a aparecer.
  if (sessionStorage.getItem('perfil_pospuesto') === usuario.id) return;

  const { data: perfil, error } = await sb
    .from('perfiles')
    .select('nombre_completo, matricula, rol')
    .eq('id', usuario.id)
    .single();

  if (error || !perfil) return;

  const esAlumno = perfil.rol === 'alumno';
  const sinNombre = !(perfil.nombre_completo || '').trim();
  const sinMatricula = !(perfil.matricula || '').trim();

  // La matrícula solo es obligatoria para alumnos (el maestro la necesita
  // para identificarlos). Para maestros/admin es "número de empleado", opcional.
  if (!sinNombre && !(esAlumno && sinMatricula)) return;

  mostrarModalPerfilIncompleto(usuario, perfil, esAlumno);
}

function mostrarModalPerfilIncompleto(usuario, perfil, esAlumno) {
  if (document.getElementById('modal-perfil-incompleto')) return; // ya está abierto

  const overlay = document.createElement('div');
  overlay.id = 'modal-perfil-incompleto';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="pi-titulo">
      <h2 id="pi-titulo" class="text-xl font-semibold mb-1">Completa tu perfil</h2>
      <p class="text-sm mb-5" style="color: var(--text-muted);" id="pi-descripcion"></p>

      <form id="pi-form" class="space-y-4">
        <div>
          <label for="pi-nombre" class="text-sm block mb-1" style="color: var(--text-muted);">Nombre completo</label>
          <input type="text" id="pi-nombre" required autocomplete="name">
        </div>
        <div>
          <label for="pi-matricula" class="text-sm block mb-1" style="color: var(--text-muted);" id="pi-matricula-label"></label>
          <input type="text" id="pi-matricula" placeholder="Ej. 201912345">
        </div>
        <p id="pi-error" class="text-sm hidden" style="color: var(--danger);"></p>
        <div class="flex gap-3 pt-1">
          <button type="button" class="btn flex-1" id="pi-despues">Más tarde</button>
          <button type="submit" class="btn btn-accent flex-1" id="pi-guardar">Guardar</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  // Los textos que dependen del rol se asignan con textContent (no HTML).
  document.getElementById('pi-descripcion').textContent = esAlumno
    ? 'Tu maestro verá tu nombre y matrícula junto a tus calificaciones.'
    : 'Agrega tus datos para que el resto del sistema pueda identificarte.';
  document.getElementById('pi-matricula-label').textContent = esAlumno
    ? 'Matrícula'
    : 'Número de empleado (opcional)';
  document.getElementById('pi-nombre').value = perfil.nombre_completo || '';
  document.getElementById('pi-matricula').value = perfil.matricula || '';
  document.getElementById('pi-nombre').focus();

  document.getElementById('pi-despues').addEventListener('click', () => {
    sessionStorage.setItem('perfil_pospuesto', usuario.id);
    overlay.remove();
  });

  document.getElementById('pi-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('pi-error');
    const boton = document.getElementById('pi-guardar');
    errorEl.classList.add('hidden');

    const nombre = document.getElementById('pi-nombre').value.trim();
    const matricula = document.getElementById('pi-matricula').value.trim();

    if (!nombre) {
      errorEl.textContent = 'Escribe tu nombre completo.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (esAlumno && !matricula) {
      errorEl.textContent = 'Escribe tu matrícula para que tu maestro pueda identificarte.';
      errorEl.classList.remove('hidden');
      return;
    }

    boton.disabled = true;
    boton.textContent = 'Guardando…';

    const { error } = await sb
      .from('perfiles')
      .update({ nombre_completo: nombre, matricula: matricula || null })
      .eq('id', usuario.id);

    if (error) {
      errorEl.textContent = error.message;
      errorEl.classList.remove('hidden');
      boton.disabled = false;
      boton.textContent = 'Guardar';
      return;
    }

    overlay.remove();
  });
}
