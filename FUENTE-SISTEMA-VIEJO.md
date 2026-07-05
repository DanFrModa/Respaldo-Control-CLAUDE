# Volcado del sistema viejo — dónde está

La carpeta **`Respaldo CLAUDE/`** (~101 MB: los 116 CSVs de datos reales + los 292
formularios, consultas y módulos del Access viejo) se **sacó de `main` y `prueba`**
para que el repo que despliega Railway sea ligero (un repo de ~140 MB dejaba el
deploy clonando sin fin).

**No se perdió.** Sigue: en tu **PC local** (`Respaldo CLAUDE/`, ahora ignorada por
git) y en la rama **`fuente-sistema-viejo`** (snapshot completo).

Para la **migración (F10)** o para consultarlo:
`git checkout fuente-sistema-viejo -- "Respaldo CLAUDE"`

`Documentacion_MJD/` (la doc funcional validada, 168 KB) SÍ sigue en main.
