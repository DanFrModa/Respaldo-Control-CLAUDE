# ADR-0002 — La documentación funcional se referencia, no se copia

- **Estado:** Aceptado
- **Fecha:** 2026-06-10
- **Decisores:** Equipo CONTROL v2 (F0)

## Contexto

La documentación funcional del negocio —11 documentos de módulos, `DECISIONES.md` (D0–D11),
`MEJORAS.md` (A1–A10), `REQUISITOS-NUEVOS.md` (R1–R9) y `RESUMEN-EJECUTIVO.md`— ya vive en la
**raíz del repositorio**, en `Documentacion_MJD/`, junto con el volcado del sistema viejo
(`Respaldo CLAUDE/`, formularios/consultas/tablas). Es la **fuente de verdad del negocio**,
validada por Daniel.

Copiarla dentro de `docs/` (la documentación técnica del proyecto) crearía **dos copias de
la fuente de verdad**: la documentación funcional es un documento VIVO (cada validación con
Daniel y cada decisión nueva se registra ahí, regla del proyecto), y dos copias divergen en
silencio — el peor escenario para un sistema cuya construcción cita D#/A#/R# desde el código
(TSDoc de los servicios de dominio).

## Decisión

`Documentacion_MJD/` (raíz del repositorio) es la **única** fuente de verdad funcional y
**no se copia** a `docs/`. La carpeta `docs/` contiene exclusivamente documentación
**técnica** del sistema nuevo:

- `docs/arquitectura/` — los ADRs (decisiones técnicas) y diagramas/modelo de datos.
- `docs/modulos/` — cómo quedó construido cada módulo, al cerrarlo (p. ej.
  `docs/modulos/patron-crud.md`, el patrón CRUD de referencia de F0).
- `docs/GUIA-RAILWAY-R2.md` — guía de infraestructura.

Las citas en código (TSDoc de servicios) y en docs técnicas usan los identificadores
estables (`D4`, `A3`, `R7`, `doc 00 §1.1`) y enlaces relativos a `Documentacion_MJD/` —esos
identificadores solo existen en un lugar.

## Consecuencias

- (+) Una sola fuente de verdad; imposible que una copia se quede vieja.
- (+) Las decisiones nuevas de Daniel se siguen registrando donde siempre
  (`DECISIONES.md`), sin paso extra de sincronización.
- (+) El CI y Railway **no necesitan** leer la documentación funcional para construir: las
  imágenes Docker de `backend/` y `frontend/` no la incluyen.
- (−) Las referencias desde `docs/` y desde el código salen de la carpeta (`../../`);
  aceptable porque es el **mismo repositorio**.
- (−) Si algún día el sistema se separa a su propio repositorio, este ADR se reemplaza (la
  doc funcional se movería con él o se publicaría versionada).

## Alternativas consideradas

- **Copiar la documentación a `docs/funcional/`:** descartada por divergencia silenciosa de
  dos copias de un documento vivo.
- **Mover (no copiar) `Documentacion_MJD/` dentro de `docs/`:** descartada; la carpeta raíz
  es el área de trabajo de Daniel (la conoce y la navega); mover todo rompería sus
  referencias sin ganancia técnica.

## Vuelta atrás

Trivial: si se decide mover/copiar, se hace en un commit y se reemplaza este ADR.
