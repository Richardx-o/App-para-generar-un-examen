from datetime import datetime
from io import BytesIO
from uuid import uuid4

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
)

from app.models import PreguntaMezclada

_styles = getSampleStyleSheet()

_estilo_pregunta = ParagraphStyle(
    "Pregunta",
    parent=_styles["Normal"],
    fontSize=11,
    spaceAfter=4,
    spaceBefore=10,
    leading=14,
)

_estilo_opcion = ParagraphStyle(
    "Opcion",
    parent=_styles["Normal"],
    fontSize=10,
    leftIndent=18,
    leading=13,
)

_estilo_opcion_correcta = ParagraphStyle(
    "OpcionCorrecta",
    parent=_estilo_opcion,
    textColor=colors.HexColor("#1a7a1a"),  # verde para la clave del maestro
)

_estilo_titulo = ParagraphStyle(
    "Titulo",
    parent=_styles["Heading1"],
    fontSize=16,
    spaceAfter=2,
)

_estilo_subtitulo = ParagraphStyle(
    "Subtitulo",
    parent=_styles["Normal"],
    fontSize=9,
    textColor=colors.grey,
    spaceAfter=14,
)


def _construir_pdf(preguntas: list[PreguntaMezclada], mostrar_respuestas: bool) -> BytesIO:
    """
    Construye un PDF (alumno o maestro) completamente en memoria.
    No se escribe ningún archivo temporal en disco: BaseDocTemplate recibe
    directamente un buffer BytesIO como destino.
    """
    buffer = BytesIO()

    doc = BaseDocTemplate(
        buffer,
        pagesize=LETTER,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates([PageTemplate(id="unica", frames=[frame])])

    elementos = []

    titulo = "Examen - Hoja del Maestro" if mostrar_respuestas else "Examen"
    elementos.append(Paragraph(titulo, _estilo_titulo))
    elementos.append(
        Paragraph(
            f"Generado el {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')} "
            f"&nbsp;|&nbsp; {len(preguntas)} preguntas",
            _estilo_subtitulo,
        )
    )

    for idx, p in enumerate(preguntas, start=1):
        elementos.append(Paragraph(f"{idx}. {p.pregunta}", _estilo_pregunta))
        for letra in ("A", "B", "C", "D"):
            texto_opcion = f"{letra}) {p.opciones[letra]}"
            es_correcta = mostrar_respuestas and letra == p.letra_correcta
            estilo = _estilo_opcion_correcta if es_correcta else _estilo_opcion
            sufijo = "  ✓" if es_correcta else ""
            elementos.append(Paragraph(texto_opcion + sufijo, estilo))
        elementos.append(Spacer(1, 4))

    doc.build(elementos)
    buffer.seek(0)  # rebobinar para que el consumidor lea desde el inicio
    return buffer


def generar_pdf_alumno(preguntas: list[PreguntaMezclada]) -> BytesIO:
    return _construir_pdf(preguntas, mostrar_respuestas=False)


def generar_pdf_maestro(preguntas: list[PreguntaMezclada]) -> BytesIO:
    return _construir_pdf(preguntas, mostrar_respuestas=True)


def nombre_archivo(prefijo: str) -> str:
    """Genera un nombre único por petición para evitar colisiones entre
    usuarios concurrentes, aunque el archivo nunca toque el disco."""
    return f"{prefijo}_{uuid4().hex}.pdf"


_estilo_correcta_marca = ParagraphStyle(
    "CorrectaMarca",
    parent=_estilo_opcion,
    textColor=colors.HexColor("#1a7a1a"),
)

_estilo_incorrecta_marca = ParagraphStyle(
    "IncorrectaMarca",
    parent=_estilo_opcion,
    textColor=colors.HexColor("#b30000"),
)


def generar_pdf_resultado(
    titulo_examen: str,
    nombre_alumno: str,
    calificacion: float,
    detalle: list[dict],
    matricula_alumno: str | None = None,
    nombre_maestro: str | None = None,
) -> BytesIO:
    """
    PDF de resultado individual: lo que un alumno descarga después de
    entregar un examen en línea, para enseñárselo a su maestro.

    `detalle` es una lista de dicts con la forma:
        {
            "pregunta": str,
            "opciones": {"A": str, "B": str, "C": str, "D": str},
            "correcta": "A" | "B" | "C" | "D",
            "seleccionada": "A" | "B" | "C" | "D" | None,
        }
    """
    buffer = BytesIO()
    doc = BaseDocTemplate(
        buffer,
        pagesize=LETTER,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates([PageTemplate(id="unica", frames=[frame])])

    linea_alumno = f"Alumno: {nombre_alumno}"
    if matricula_alumno:
        linea_alumno += f" (Matrícula: {matricula_alumno})"

    elementos = [
        Paragraph(f"Resultado — {titulo_examen}", _estilo_titulo),
        Paragraph(
            f"{linea_alumno} &nbsp;|&nbsp; "
            f"Maestro: {nombre_maestro or '—'} &nbsp;|&nbsp; "
            f"Calificación: {calificacion}%",
            _estilo_subtitulo,
        ),
        Paragraph(
            f"Entregado el {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
            _estilo_subtitulo,
        ),
    ]

    for idx, p in enumerate(detalle, start=1):
        elementos.append(Paragraph(f"{idx}. {p['pregunta']}", _estilo_pregunta))
        for letra in ("A", "B", "C", "D"):
            texto_opcion = f"{letra}) {p['opciones'][letra]}"
            es_correcta = letra == p["correcta"]
            fue_seleccionada = letra == p["seleccionada"]

            if es_correcta:
                estilo = _estilo_correcta_marca
                sufijo = "  ✓ correcta"
            elif fue_seleccionada:
                estilo = _estilo_incorrecta_marca
                sufijo = "  ✗ tu respuesta"
            else:
                estilo = _estilo_opcion
                sufijo = ""

            elementos.append(Paragraph(texto_opcion + sufijo, estilo))
        elementos.append(Spacer(1, 4))

    doc.build(elementos)
    buffer.seek(0)
    return buffer