-- ⭐⭐ FILA 0.155 — EL PROYECTO RECUERDA: su COMPRADOR, su GÉNERO y su AÑO DE ENTREGA.
--
-- Son las dos peticiones de Daniel del 7-sep-2026, ya cerradas en
-- `Documentacion_MJD/DECISIONES.md` §Post-F9.210 puntos (1) y (2):
--
--   (1) *«ese catálogo debe de tener la opción de seleccionar al comprador cuando se hace un
--       precosteo. Normalmente un proyecto va dirigido a un solo comprador»*
--       ⇒ FK OPCIONAL `id_cliente_contacto`. El catálogo `cliente_contacto` ya estaba COMPLETO
--       desde §Post-F9.152 (puesto libre, alta/baja con `activo`, departamento opcional):
--       faltaba SÓLO la liga.
--
--   (2) *«un proyecto nace con un género o departamento definido… todos los modelos nuevos
--       deberían jalar el género desde ahí. Que no vuelva a preguntar… lo mismo el año de
--       entrega»* ⇒ *«en el proyecto y cada modelo hereda esa información (con opción a
--       cambiarla)»*
--       ⇒ `id_genero` + `anio_entrega` en el proyecto.
--
-- 🔑 POR QUÉ EL (2) VALE MÁS QUE LA COMODIDAD. Un modelo sin género NO SE PUEDE NUMERAR
-- (`dominio/modelos/nomenclatura.ts`, `digitosDelModelo`), y ese error hoy salta hasta «Generar
-- OP» — DESPUÉS de que alguien tecleó la matriz color×talla completa. Heredarlos al nacer el
-- modelo cierra el agujero por arriba, que es donde cuesta un clic en lugar de una captura.
--
-- ⚠️ POR QUÉ AQUÍ Y NO EN LOS CATÁLOGOS (las dos alternativas, medidas antes de elegir):
--   • `cliente_departamento` NO tiene FK a `generos`: se llama «NIÑOS» y el sistema no sabe que
--     eso ES un género. Colgarla ahí obligaría a mapear a mano departamento por departamento y
--     cliente por cliente — y muchos departamentos son TEMAS («Disney», «básicos») o abarcan
--     varios géneros, así que el mapeo ni siquiera existe siempre.
--   • `temporadas` NO tiene año, y no puede tenerlo: es un catálogo GLOBAL con `nombre` UNIQUE
--     («Primavera-Verano») que se repite cada año ⇒ meterle el año obligaría a una fila por año
--     y rompería las que ya hay.
--   El proyecto es el único sitio donde los dos datos son ciertos sin tocar catálogo existente.
--
-- ══ REGLA 0-B ══════════════════════════════════════════════════════════════════════════════════
-- Las TRES columnas nacen NULL y NO SE RELLENAN. Un proyecto anterior a esta fila no tiene
-- comprador, ni género, ni año, y eso NO es un defecto: el sistema lo tolera (el alta de modelo
-- nuevo vuelve a preguntar lo que el proyecto no sepa). Cero backfill, cero UPDATE.
--
-- ⚠️ `ON DELETE RESTRICT` en las dos FK, igual que las otras tres del proyecto (cliente,
-- departamento, temporada): a un contacto se le da de BAJA con `activo=false` (D3) y a un género
-- también, nunca se borran, así que Restrict no bloquea ningún flujo real — y si alguien borrara
-- uno, el proyecto no puede quedarse sin saber a quién iba dirigido.
--
-- ADITIVA. Nada destructivo. SIN permisos nuevos (reusa `desarrollo.ver` / `desarrollo.administrar`)
-- y SIN semillas.

-- AlterTable
ALTER TABLE "proyectos" ADD COLUMN     "anio_entrega" INTEGER,
ADD COLUMN     "id_cliente_contacto" INTEGER,
ADD COLUMN     "id_genero" INTEGER;

-- CreateIndex
CREATE INDEX "proyectos_id_cliente_contacto_idx" ON "proyectos"("id_cliente_contacto");

-- CreateIndex
CREATE INDEX "proyectos_id_genero_idx" ON "proyectos"("id_genero");

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_id_cliente_contacto_fkey" FOREIGN KEY ("id_cliente_contacto") REFERENCES "cliente_contacto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_id_genero_fkey" FOREIGN KEY ("id_genero") REFERENCES "generos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
