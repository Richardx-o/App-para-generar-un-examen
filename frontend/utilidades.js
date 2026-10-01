// Funciones compartidas por todos los paneles.

// Escapa texto antes de meterlo en innerHTML. Todo lo que viene de la base
// de datos (nombres, matrículas, preguntas, opciones, títulos) pasa por aquí:
// si alguien escribe "<img onerror=...>" se muestra como texto y no se ejecuta.
function escaparHTML(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
