# Arquitectura — Registros de Decisión (ADRs)

Esta carpeta guarda las **decisiones técnicas importantes** del proyecto en forma de ADRs
(_Architecture Decision Records_), como exige el plan maestro (§8.4: "cada decisión técnica
importante queda escrita con su porqué — incluido el contrato OpenAPI, la red privada, el
hash de passwords, la auditoría sin FK").

## Qué es un ADR

Un ADR es un documento corto que registra **una** decisión de arquitectura: qué se decidió,
en qué contexto, qué alternativas se consideraron y qué consecuencias tiene. Se escribe
**cuando se toma la decisión**, no después. Sirve para que cualquier persona (o agente) que
llegue al proyecto entienda _por qué_ las cosas son como son, sin re-litigar lo ya decidido
ni repetir investigaciones.

Reglas:

- **Un ADR por decisión.** Numeración secuencial `ADR-NNNN-titulo-corto.md`.
- **Los ADRs no se editan para cambiar la decisión.** Si una decisión se revierte o se
  reemplaza, se escribe un ADR nuevo y el viejo se marca como `Reemplazado por ADR-NNNN`.
  (Correcciones menores de redacción sí se permiten.)
- Estados posibles: `Aceptado` · `Reemplazado por ADR-NNNN` · `Obsoleto`.
- No confundir con las **decisiones de negocio** de Daniel (D0–D12): esas viven en
  [`Documentacion_MJD/DECISIONES.md`](../../Documentacion_MJD/DECISIONES.md) y son de
  dominio, no de tecnología. Un ADR puede referenciarlas.

## Plantilla

```markdown
# ADR-NNNN — Título

- **Estado:** Aceptado
- **Fecha:** AAAA-MM-DD
- **Decisores:** (quién la tomó / validó)

## Contexto

(El problema y las restricciones. Qué decía el plan, qué se encontró en la realidad.)

## Decisión

(Qué se decidió, en afirmativo.)

## Consecuencias

(Positivas y negativas. Qué se gana, qué se asume, qué hay que vigilar.)

## Alternativas consideradas

(Qué más se evaluó y por qué se descartó.)

## Vuelta atrás

(Cómo se revierte o migra esta decisión si hiciera falta.)
```

## Índice

| ADR                                                | Título                                                            | Estado   |
| -------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| [ADR-0001](ADR-0001-arquitectura-backend-frontend-separados.md) | Backend y frontend separados, dockerizados, comunicados por REST/OpenAPI (no monorepo) | Aceptado |
| [ADR-0002](ADR-0002-doc-funcional-referenciada.md) | La documentación funcional se referencia, no se copia             | Aceptado |
| [ADR-0003](ADR-0003-better-auth.md)                | better-auth en lugar de Auth.js v5 (beta)                         | Aceptado |
| [ADR-0004](ADR-0004-hash-scrypt.md)                | Hash de contraseñas con scrypt (better-auth) en lugar de argon2   | Aceptado |
| [ADR-0005](ADR-0005-auditoria-sin-fk.md)           | Campos de auditoría sin FK físico hacia Usuario                   | Aceptado |
| [ADR-0006](ADR-0006-openapi-desde-zod.md)          | El contrato OpenAPI se genera desde los esquemas Zod del backend  | Aceptado |
| [ADR-0007](ADR-0007-catalogos-globales-vs-por-empresa.md) | Catálogos maestros globales; `idEmpresa` solo en lo operativo (A9) | Aceptado |
| [ADR-0008](ADR-0008-schema-prisma-archivo-unico.md) | `schema.prisma` archivo único (no `prismaSchemaFolder`) en F1     | Aceptado |
| [ADR-0009](ADR-0009-materiales-f1e3.md)            | Catálogos de materiales F1-E3: telas unificadas, avíos NULLABLE, fallback de precio | Aceptado |
| [ADR-0010](ADR-0010-motor-kardex-produccion.md)    | Motor de kardex genérico y modelo de datos de Producción (F3-E1)  | Aceptado |
| [ADR-0011](ADR-0011-eventos-outbox-pgboss.md)      | Eventos de dominio con OUTBOX transaccional + pg-boss (F4-E3)     | Aceptado |
| [ADR-0012](ADR-0012-motor-rc-duracion-y-jobs.md)   | Motor de la RC (pt1): fórmula de duración + jobs pg-boss con serialización por orden (F5-E3) | Aceptado |
| [ADR-0013](ADR-0013-cpm-backward-pass-y-semaforo.md) | Motor de la RC (pt2): CPM backward-pass + semáforo (F5-E4)        | Aceptado |
| [ADR-0014](ADR-0014-pt-por-orden.md)               | Existencia de PT por ORDEN de producción (enmienda de ADR-0010, F6-E2) | Aceptado |
| [ADR-0015](ADR-0015-kpis-vistas-materializadas-y-job.md) | KPIs sobre vistas materializadas + job de refresco (la captura nunca espera) (F7-E3) | Aceptado |
| [ADR-0016](ADR-0016-cpm-forward-pass-colchon-proyectado.md) | CPM forward pass: colchón proyectado para las alertas predictivas (rediseño R7) | Aceptado |
| [ADR-0017](ADR-0017-modelo-tercero-referencias.md) | Modelo del TERCERO en la cuenta corriente: referencias por tipo+id (no tabla polimórfica) | Aceptado |
| [ADR-0018](ADR-0018-consecutivo-produccion-lock-vs-secuencia.md) | El consecutivo del nº de PRODUCCIÓN no sale de una secuencia: hueco libre bajo advisory lock (V1-E3n) | Aceptado |
