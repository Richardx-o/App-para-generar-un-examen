from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class Dificultad(str, Enum):
    facil = "facil"
    media = "media"
    dificil = "dificil"


class PreguntaDB(BaseModel):
    """Representa una fila tal cual viene de Supabase."""
    id: UUID
    pregunta: str
    opcion_a: str
    opcion_b: str
    opcion_c: str
    opcion_d: str
    respuesta_correcta: str  # 'A' | 'B' | 'C' | 'D'
    dificultad: str
    categoria: str


class PreguntaMezclada(BaseModel):
    """Pregunta con las opciones ya barajadas y la letra correcta recalculada."""
    id: UUID
    pregunta: str
    opciones: dict  # {"A": "...", "B": "...", "C": "...", "D": "..."}
    letra_correcta: str
    dificultad: str
    categoria: str


class GenerarExamenRequest(BaseModel):
    cantidad: int = Field(default=6, ge=1, le=50)
    categoria: Optional[str] = None
    dificultad: Optional[Dificultad] = None
