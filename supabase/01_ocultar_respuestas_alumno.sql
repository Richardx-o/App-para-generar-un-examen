-- =========================================================
-- Ocultar la clave de respuestas (examen_preguntas.letra_correcta)
-- a los usuarios del navegador.
--
-- Por qué es seguro:
--   * calificar_intento, crear_examen_completo y unirse_a_examen son
--     SECURITY DEFINER: corren con permisos del dueño, no del alumno,
--     así que siguen leyendo/escribiendo letra_correcta sin problema.
--   * El backend (PDF de resultados) usa la service key, que no se ve
--     afectada por estos permisos.
--   * El frontend ya no pide letra_correcta (alumno.js pide columnas
--     explícitas, sin select('*')).
--
-- En Postgres no se puede quitar UNA columna si el permiso está dado a
-- toda la tabla: hay que quitar el SELECT completo y volver a darlo solo
-- en las columnas permitidas. RLS sigue funcionando igual que antes.
-- =========================================================

revoke select on public.examen_preguntas from anon, authenticated;

grant select (id, examen_id, pregunta_id, orden,
              pregunta_texto, opcion_a, opcion_b, opcion_c, opcion_d)
  on public.examen_preguntas to authenticated;
