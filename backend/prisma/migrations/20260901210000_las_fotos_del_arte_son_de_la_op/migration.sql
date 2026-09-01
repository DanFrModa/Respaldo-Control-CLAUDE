-- ⭐ «LAS FOTOS DEL ARTE SON DE LA OP» — heredar, ocultar y agregar fotos de arte POR ORDEN
-- (§Post-F9.177). Es la otra mitad de lo que la 0.082 hizo con la foto de la PRENDA.
--
-- 🔴 DANIEL, textual: *«Un modelo de desarrollo que se va a usar para **4 órdenes diferentes** no
-- puede usar la misma foto ni del modelo **ni de arte** para todas las OP. Tendría que haber la
-- posibilidad de **modificar las fotos directamente en la OP**. Entiendo que **la OP es de donde
-- cuelgan las fotos directamente, no del desarrollo**.»* Y: *«aplica para fotos de la prenda pero
-- también **del arte**»*.
--
-- Aquí NO existía nada: `orden_arte` no tenía ni una columna de fotos, ninguna ruta las exponía y
-- ninguna pantalla las pintaba. Lo único que hoy enseña una foto de arte de una OP es su IMPRESO,
-- y las lee vivas del arte del MODELO. Un arte AGREGADO A MANO (`id_modelo_arte` NULL) no podía
-- llevar foto en absoluto: no había dónde ponerla.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- LA DECISIÓN: heredar + ocultar + agregar. **NO congelar.**
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- `orden_arte` CONGELA una copia del renglón del modelo (descripción, posición, puntadas, precio,
-- proveedor), así que lo natural sería congelar también las fotos. Se midió, y sale caro por tres
-- lados — cada uno verificable en el código de hoy:
--
--  1. **Le arrebataría a la OP lo que acaba de guardar.** `borrarArchivoSiQuedoHuerfano`
--     (`dominio/modelos/arte-modelo.ts`) decide si borra el `Archivo` contando SÓLO
--     `modelo_arte_foto`. Unas filas congeladas que compartieran `id_archivo` (que es justo lo que
--     hace hoy «copiar arte de otro modelo»: comparten objeto de R2, que no se clona desde SQL) se
--     irían con ese `Archivo` por CASCADE, y su objeto de R2 detrás — en silencio, por una acción
--     del dueño del MODELO. Y enseñarle esa cuenta a `orden_arte_foto` dejaría el objeto pagándose
--     para siempre en cuanto una sola OP lo hubiera congelado: exactamente lo que cerró la 0.081.
--  2. **Rompería lo que hoy funciona.** `copiarRecetaDelModelo` sólo corre al CREAR la orden. Sin
--     backfill (REGLA 0-B), TODAS las órdenes que ya existen se quedarían sin fotos de arte en su
--     impreso — que hoy sí las lleva (petición de Daniel, jul-2026). «No gastar en reparar el
--     pasado» no es permiso para romper lo que hoy funciona; la propia regla lo dice.
--  3. **Se separaría en silencio.** La desalineación (`calcularDesalineacion`, en
--     `dominio/produccion/receta-orden.ts`) compara existencia y precio; para el ARTE ni siquiera
--     compara consumo, y **fotos no compara ninguna**. Una foto que el arte del modelo gane
--     DESPUÉS de abrir la OP no llegaría nunca y nadie se enteraría. La prenda evita eso a propósito.
--
-- Así que se copia el patrón ya construido y probado para la prenda (§Post-F9.169(b)), llevado del
-- nivel de la ORDEN al del RENGLÓN de arte:
--   • **heredar**: las fotos del arte del modelo se leen VIVAS por la traza `orden_arte
--     .id_modelo_arte` (que ya viene resuelta por linaje: un modelo hijo por color copia la receta
--     de su modelo de desarrollo, V1-E9b);
--   • **ocultar**: `orden_arte_foto_oculta`, una MARCA reversible por *(renglón, foto del modelo)*;
--   • **agregar**: `orden_arte_foto`, las fotos que ESTA OP subió — y la única forma que tiene de
--     llevar foto un arte agregado a mano.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 🔴 OCULTAR NO ES BORRAR (D3)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- La foto del arte del modelo **no se toca**: ni se borra, ni deja de ser la principal, ni sale de
-- la galería, ni se pierde para las demás órdenes. Ocultar y volver a mostrar son un INSERT y un
-- DELETE de una fila de 4 columnas; **el objeto de Cloudflare sigue exactamente donde estaba**.
-- Sólo `orden_arte_foto` habla de archivos, y de los que la OP subió ella misma.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Lo que esta migración NO hace
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- • **SIN BACKFILL** (REGLA 0-B): las dos tablas nacen VACÍAS y ésa es la respuesta correcta para
--   todo lo anterior — nadie había podido ocultar ni subir nada. Un renglón sin filas aquí se
--   comporta EXACTAMENTE como hoy: enseña las fotos del arte del modelo, todas.
-- • **SIN permisos nuevos** ⇒ este deploy **NO requiere** `SEED_ON_START`. Reusa los que ya
--   gobiernan la receta de la OP: leer = `ordenes.ver` **o** `desarrollo.ver` (la misma pareja de
--   `exigirVerLaReceta`, V1-E3j) y mutar = `desarrollo.administrar` (§Post-F9.72, las siete
--   mutaciones de la receta). Gatearlas con `ordenes.administrar` reabriría el agujero que cerró
--   V1-E3j: un usuario de Desarrollo puro puede cambiarle a ese mismo renglón la descripción, el
--   precio y el proveedor, y hasta quitarlo — pero no su foto.
-- • 100 % ADITIVA: dos tablas nuevas con sus índices, dos llaves únicas y cuatro FKs. No toca ni
--   una fila existente, no cambia ningún default y no restringe nada de lo que hoy se puede hacer.
--
-- ⚠️ Las CUATRO FKs son CASCADE, y `orden_arte_foto_oculta → modelo_arte_foto` va contra la
-- costumbre de la casa (RESTRICT para catálogos en uso) **a propósito**: esconder una foto en una
-- OP no puede secuestrar el arte del modelo. Si el dueño del modelo la borra, la marca que la
-- escondía se va con ella — nunca al revés.
--
-- ⚠️ `orden_arte_foto` SÍ lleva `UNIQUE(id_archivo)` y `modelo_arte_foto` a propósito NO: allá
-- varios artes comparten el mismo objeto de R2 (herencia de sacar el arte del catálogo); aquí el
-- archivo NACIÓ en esta OP y no lo comparte nadie, así que quitarlo puede liberar su objeto sin la
-- cuenta de huérfanos que necesita el lado del modelo.

-- CreateTable
CREATE TABLE "orden_arte_foto" (
    "id" SERIAL NOT NULL,
    "id_orden_arte" INTEGER NOT NULL,
    "id_archivo" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "orden_arte_foto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orden_arte_foto_oculta" (
    "id" SERIAL NOT NULL,
    "id_orden_arte" INTEGER NOT NULL,
    "id_modelo_arte_foto" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "orden_arte_foto_oculta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orden_arte_foto_id_orden_arte_idx" ON "orden_arte_foto"("id_orden_arte");

-- CreateIndex
-- Un archivo subido a una OP es de UN renglón (ver el aviso de arriba: es lo que permite borrar su
-- objeto de R2 sin contar huérfanos).
CREATE UNIQUE INDEX "orden_arte_foto_id_archivo_key" ON "orden_arte_foto"("id_archivo");

-- CreateIndex
CREATE INDEX "orden_arte_foto_oculta_id_orden_arte_idx" ON "orden_arte_foto_oculta"("id_orden_arte");

-- CreateIndex
CREATE INDEX "orden_arte_foto_oculta_id_modelo_arte_foto_idx" ON "orden_arte_foto_oculta"("id_modelo_arte_foto");

-- CreateIndex
-- LA LLAVE: un renglón oculta una foto UNA vez. Es lo que vuelve idempotente el «ocultar» (dos
-- clics no dejan dos lápidas) sin que el dominio tenga que leer antes de escribir bajo carrera.
CREATE UNIQUE INDEX "orden_arte_foto_oculta_id_orden_arte_id_modelo_arte_foto_key" ON "orden_arte_foto_oculta"("id_orden_arte", "id_modelo_arte_foto");

-- AddForeignKey
ALTER TABLE "orden_arte_foto" ADD CONSTRAINT "orden_arte_foto_id_orden_arte_fkey" FOREIGN KEY ("id_orden_arte") REFERENCES "orden_arte"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_arte_foto" ADD CONSTRAINT "orden_arte_foto_id_archivo_fkey" FOREIGN KEY ("id_archivo") REFERENCES "archivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_arte_foto_oculta" ADD CONSTRAINT "orden_arte_foto_oculta_id_orden_arte_fkey" FOREIGN KEY ("id_orden_arte") REFERENCES "orden_arte"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_arte_foto_oculta" ADD CONSTRAINT "orden_arte_foto_oculta_id_modelo_arte_foto_fkey" FOREIGN KEY ("id_modelo_arte_foto") REFERENCES "modelo_arte_foto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
