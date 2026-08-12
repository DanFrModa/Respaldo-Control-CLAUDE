# Diagnóstico del flujo completo — camino a la primera versión

> **13-ago-2026.** Daniel: *"Me quiero ir proceso por proceso desde el inicio hasta el final para ver
> todos los detalles, pantallas que aún faltan… Ya quiero sacar la primera versión. Ya se fue mucho
> tiempo con esto."*
>
> Se recorrió el sistema **paso por paso, como el usuario**, en siete tramos paralelos, verificando
> contra el código: que existan las pantallas, que exista **el botón** que lleva al paso siguiente,
> qué falta, qué sobra y qué no tiene sentido.

**Estado de la revisión:** 6 de 7 tramos cerrados. El tramo de **compras y recepción de material**
quedó en revisión al cierre de este documento; se agrega cuando termine.

**Todo lo de abajo está verificado en el código.** Lo que no se pudo verificar va marcado como tal.

---

## 1. Las dos decisiones que acortan el camino

### Se puede salir facturando por fuera — **SÍ**

**CONTROL no factura y no va a facturar el día uno.** R14 (timbrado vía PAC) está explícitamente
diferido; no hay código de PAC, sellado, serie, folio fiscal ni certificado. La factura se sigue
haciendo en **SINUBE** y CONTROL solo **importa el XML**.

Eso simplifica el arranque: **no hacen falta** folios, series, certificados `.cer`/`.key`, FIEL ni
contrato con un PAC. Y toda la operación —entrega, kardex, producción, compras, costos, EDR— es
independiente de Finanzas.

**Recomendación: arrancar con CxC/CxP dormidas** hasta que llegue el corte de SINUBE. Cobranza sin
saldo de apertura no es media función: **da respuestas equivocadas** (un cliente que debe $2M aparece
en $0 hasta que se importe su primer CFDI).

Dos matices:
- **EsMa SÍ se migra** en el go-live → el día 1 los **maquileros tendrán saldo** y los clientes y
  proveedores comerciales estarán en cero. Asimetría que hay que explicarle a quien lo use.
- **CxP ya no se puede apagar del todo**: desde §Post-F9.21, confirmar una entrada de tela con CFDI
  **crea el cargo de CxP automáticamente**, saltando el guard de permisos. El libro se llena aunque
  nadie abra el menú.

### Calidad y Ruta Crítica se pueden apagar — **con una diferencia importante**

**Calidad: SÍ, sin reservas.** Cero acoplamiento entrante: nada fuera de `calidad/` y `ruta-critica/`
escribe ni valida contra auditorías. `requisitos-orden.ts:27-30`, textual: *"el estado es INFORMATIVO:
ninguna pantalla de captura filtra ni bloquea por él — lo único que impide operar es `cancelada`"*.
Único efecto de apagarla: se pierde la reclasificación Primeras↔Segundas.

**Ruta Crítica: no bloquea nada, pero NO se puede "dejar apagada" tal como está.** La única
referencia fuera del módulo en todo el dominio es una lectura del tablero de inicio
(`resumen.ts:337`). Es puramente **consumidora** de eventos, nunca emisora de bloqueos.

⚠️ **Pero se enciende sola y no hay interruptor:**
1. `rcAutomatica.ts` genera la ruta de **toda orden nueva**. Cada orden nace con ~26 procesos.
2. Esos procesos **vencen solos** (CPM hacia atrás desde la entrega). Si nadie captura, todo queda
   "vencido".
3. Al **admin** le aparecen TODAS: `procesosResponsablesDe` devuelve `null` (sin filtro) si tienes
   `roles.administrar` (`bandeja.ts:183-192`). **Daniel, que es admin, vería cientos de "vencidas"
   ajenas**, más la campana roja en cada pantalla.

**Salidas posibles:** quitar `rc.ruta-ver` de los roles de v1 —apaga menú, campana y pantalla de un
golpe, porque todo cuelga de ese permiso— o dejar solo los ~18 procesos que se marcan solos.

Si **sí** se usa en v1, tres prerrequisitos duros: correr el ETL de F5 (plantillas), asignar
`UsuarioRol` a la gente real, y cargar el calendario con los festivos de FR Moda.

---

## 2. Lo que bloquea

### 2.1 El ciclo de producción no cierra

| # | Hallazgo | Evidencia |
|---|---|---|
| B1 | **«Entrega a cliente» no tiene puerta.** La pantalla existe y funciona, pero no está en el riel, **ninguna pantalla la enlaza**, y `/produccion` **no tiene hub**: cae en el comodín y pinta *"Próximamente"* para un módulo terminado. Único camino: ⌘K, la URL, o el deep-link **condicional** de Mis pendientes de RC. **El producto entra a PT y no sale nunca.** | `catalogo.ts:344,1451` · `App.tsx:368` |
| B2 | **El panel de Avance no incluye la entrega**: el ciclo de la OP termina visualmente en "Recibo de Arte". | `AvanceProduccion.tsx:61-79` |
| B3 | **El PT que produce la fábrica no se puede mover.** El recibo etiqueta la entrada con `idOrden` y la existencia se valida **por orden**, pero movimientos manuales y traspasos escriben y validan contra el bucket `idOrden = null`. → las piezas **solo salen por la entrega a cliente de esa orden**: no se traspasan, no salen por movimiento manual (muestras, mermas, ajuste de conteo). Y la pantalla **sí muestra el stock** → el usuario ve existencia que el sistema le rechaza mover. | `recibos.ts:632-650` · `kardex.ts:182` · `movimientos-pt.ts:134-196` |
| B4 | **Las segundas no se pueden capturar** por el camino principal (manda solo `{idTalla, cantidad}` → el backend lo lee como "todo primeras"). El toggle existe solo en `/produccion/recibos`, **fuera del riel**. | `AvanceProduccion.tsx:1148` · `recibos.ts:194-199` |

> ⚠️ **B3 está razonado del código, no ejecutado.** Verificar en vivo antes de tocar nada.

### 2.2 El menú sigue tapando módulos terminados

| # | Hallazgo | Evidencia |
|---|---|---|
| B5 | **15 de 17 sub-vistas de Producción están fuera del menú**: captura de corte, envío a maquila, recibo, entrega a cliente, tablero WIP, corte semanal, recibos semanales, consultas, órdenes incompletas… Es exactamente lo que se destapó el 12-ago en Inventarios/Telas/Avíos/Compras; **a Producción nunca se le hizo**. | `catalogo.ts:1451` |
| B6 | **El hub `/calidad` está huérfano**: en el riel "Calidad" es padre desplegable con solo 2 hijos y `PadreNav` **no navega** (es un `<button>` que solo expande). → **defectos, tipos de producto, planes AQL y auditorías por maquilero son inalcanzables** desde toda la app. | `catalogo.ts:1453` · `NavegacionModulos.tsx:260-284` |

### 2.3 Daño silencioso a los datos

| # | Hallazgo | Evidencia |
|---|---|---|
| B7 | **Importar dos veces la misma OC duplica todo en silencio**: pedido, OPs, nº de producción, RC y MRP. No hay chequeo previo ni `@@unique` sobre `Orden.ocCliente`. **No truena: se descubre semanas después, cortando doble.** | `importacion-pdf.ts:776-820` |
| B8 | **Se puede congelar un precosto con costo CERO.** Si el modelo no tiene BOM quedan solo corte y maquila (en $0 si son null) y `congelarVersion` solo exige ≥1 renglón. Esa versión **inmutable** puede acabar de base de un precio de lista. Sin ningún aviso. | `precostos.ts:1028`, `:302-317` |
| B9 | **Un renglón de lista de precios no se puede quitar ni agregar, y la lista no se puede borrar.** Con `@@unique([idDesarrollo])`, un desarrollo metido por error **queda atrapado para siempre**: no se puede sacar ni meter en otra. | `listas-precios.rutas.ts:103-390` · `schema.prisma:6441` |
| B10 | **El factor de conversión se ignora al generar la OC del MRP**: la línea va en unidad de CONSUMO y el resto la lee como PRESENTACIÓN. Con un rollo de 50 m, recibir **infla la existencia ×50 y divide el costo ÷50**. Hoy solo avisa. | `mrp.ts:815-819` |

### 2.4 Cosas que se acaban sin avisar

| # | Hallazgo | Evidencia |
|---|---|---|
| B11 | **No se puede hacer un RESURTIDO.** "Generar OP" solo se pinta si el renglón no tiene orden. El backend modela N órdenes por renglón **a propósito** y `POST /api/ordenes` existe, pero **nadie lo llama** desde el frontend. | `PedidosMesPagina.tsx:596-609` · `salida-produccion.ts:20-23` |
| B12 | **`noProducir` bloquea sin salida.** Rechaza "Generar OP" y **el campo no aparece en ninguna pantalla**. Los pedidos migrados traen la bandera. | `ordenes.ts:298-301` |
| B13 | **La plantilla del importador Excel es irreversible.** Con plantilla vigente el asistente salta al paso 3; no hay "Atrás", ni "Cambiar formato", ni pantalla de plantillas. El cliente cambia el orden de sus columnas → basura sin salida. | `ImportadorPedido.tsx:186-199` |
| B14 | **Los selectores de cliente traen máximo 100** y hay ~117 clientes. Mismo defecto que ya se arregló con modelos. | `ProyectosPagina.tsx:56` · `paginacion.ts:17` |

### 2.5 Cobranza sobre datos falsos

| # | Hallazgo | Evidencia |
|---|---|---|
| B15 | **Los días de crédito del cliente NO se aplican.** `exigirTercero` hard-codea `diasCredito: 0` para clientes, con un TSDoc obsoleto que dice "llega en E4" — pero `Cliente.diasCredito` **ya existe** y la bandeja lo muestra. Como `fechaVencimiento` se **persiste**, **toda factura vence el mismo día** y cae en "vencido" al día siguiente. **Todo el aging de CxC es falso.** | `terceros.ts:46` vs `schema.prisma:1039` |
| B16 | **Sin RFC, el CFDI no se puede ligar a su pedido/OC.** Los candidatos salen vacíos si el cliente no se reconoce por RFC, y el frontend exige que el elegido sea el sugerido → **elegirlo a mano no sirve**. Ni el ETL de clientes ni el de proveedores migran RFC. | `cfdi-ventas.ts:219` · `ImportarCfdiVentaPagina.tsx:64` |
| B17 | **No hay ningún puente Entrega → Cobro.** El CFDI se liga a un **pedido**, nunca a la entrega. Quien entregó no sabe que hay que cobrar; quien cobra no ve qué se entregó. | todo el tramo |

### 2.6 Arranque: la gente no podría trabajar

| # | Hallazgo | Evidencia |
|---|---|---|
| B18 | **Los 18 roles funcionales de RC se crean con CERO permisos.** El upsert solo crea la fila `Rol` y **nunca inserta un `RolPermiso`**. El ETL les asigna esos roles a los usuarios → **entran y no pueden hacer nada**. Cada persona necesita **dos roles**: uno de acceso + su rol funcional. | `seed-ruta-critica.ts:29-47`, `:476-482` |
| B19 | **No existe ETL de usuarios.** Los ~23 se capturan a mano, con el `username` **idéntico al de Access** o su Bandeja de RC queda vacía al re-correr el ETL. | `usuarios-roles.ts:47-52` |
| B20 | **Sin guard anti-lockout de usuarios** (sí existe para roles). Desactivar al último admin deja el sistema sin llave — escenario realista creando 23 usuarios a mano. | `dominio/admin/usuarios.ts` |
| B21 | **El catálogo de direcciones de entrega nace vacío** y sin una favorita `autorizarOC` **rechaza** las OC del MRP. | `mrp.ts:800` |
| B22 | **Los 40 defectos de calidad NO están en el seed** (los carga el ETL de F6-E6). Sin correr ese ETL la captura arranca con grid vacío — y B6 impide llegar a capturarlos. | `seed-calidad.ts:11` |
| B23 | **Solo 2 de 6 plantillas de ruta en el seed, sin fallback por familia.** Programar con los artículos 2/6–5/6 **truena** si no corrió el ETL de F5. | `seed-ruta-critica-plantillas.ts:138-140`, `:242` |
| B24 | **Prerrequisitos de despliegue** sin los cuales Finanzas no existe: `SEED_ON_START=true` (sin él **el riel Finanzas no aparece**), RFC de FR Moda, R2 en producción (`R2_SUBIDA_LOCAL` **rehúsa arrancar** en production). | `seed.ts:170-183` · `cfdi-comun.ts:14` |

---

## 3. Lo que duele (selección — el detalle por tramo abajo)

- **No se puede reimprimir nada** en producción: los PDF solo se ofrecen para el movimiento recién
  guardado, y **el camino principal no imprime** — la ruta que el usuario recorre de verdad no
  produce el papel que va con el bulto al maquilero.
- **Tres pantallas duplicadas del mismo acto** (corte / envío / recibo) conviviendo con el panel de
  avance, y **ninguna es completa**: las viejas imprimen y capturan segundas, la nueva tiene el
  default de maquilero y el typeahead. El usuario no tiene forma de saber cuál usar.
- **El pedido importado nace sin fechas** → cae en el mes equivocado; y por Excel la OP queda sin
  fecha de entrega, lo que **deja a la RC muda sin avisar** (omite el backward-pass).
- **"Cancelar pedido" miente**: dice *"deja de producirse"* y las OPs siguen vivas, cortándose, con
  su RC corriendo.
- **La orden nunca llega a un estado final**: una entregada hace tres meses sigue leyéndose
  "Cortada".
- **Si la OP no trae precio de maquila, el cargo EsMa nace sin precio** y hay que teclearlo aparte —
  justo la doble captura que la doc dice que v2 elimina.
- **Al abrir la versión 2 de un precosto para negociar se pierden los renglones manuales.**
- **Dos lugares para pagarle al mismo maquilero**, sin referencia cruzada ni protección contra doble
  captura. Y **"abono" significa lo contrario** en EsMa (+) y en el motor (−), en el mismo riel.
- **Las advertencias del cálculo de duración de la RC se calculan y se tiran.**
- **El catálogo de Auditores no se conecta con nada**: su contador siempre da 0 y no se puede elegir
  quién auditó.
- **Sin cambio de contraseña de auto-servicio**: solo el admin puede cambiarlas.
- **Sin respaldos automáticos propios** (solo la pestaña de Railway, y habilitarla es manual).
- **Los festivos son solo de 2026**, hardcodeados. Si el go-live cruza el año, el CPM cuenta el
  1-ene-2027 como hábil.

---

## 4. El plan

En este orden. El tramo de compras, cuando cierre, se suma al punto 4.

1. **Los cuatro arreglos del precosteo** — en curso: buscador de modelos, cliente visible, elegir
   avío del catálogo, botón para generar la lista. *Es lo que desbloquea a Daniel para seguir
   probando.*
2. **Cerrar el ciclo de producción** — destapar el menú de Producción y de Calidad, meter la entrega
   al cliente en el panel de avance, y **verificar B3 en vivo**.
3. **Las defensas contra daño callado** — doble importación, congelar en cero, resurtido, renglón de
   lista atrapado. *Todo esto corrompe datos sin avisar, que es lo peor que puede pasar en producción.*
4. **Lo que hace que los números sean tuyos** — el amarre proveedor↔insumo (sin él el precosteo usa
   precios genéricos) y el factor de conversión (B10).
5. **Preparar el arranque** — permisos de los roles de RC, guard anti-lockout, respaldos automáticos,
   cabeceras de seguridad; y decidir si el conteo físico se teclea o se construye un importador.
6. **El ensayo completo** — vaciar `prueba`, correr toda la migración cronometrada, y la prueba reina
   de punta a punta cuadrando cada número a mano con Daniel.

---

## 5. Lo que hace falta decidir

1. **¿Ruta Crítica se enciende o se apaga en la v1?** Si se enciende: correr su ETL, asignar roles a
   la gente y cargar los festivos de la planta.
2. **¿El "comprobante de entrega a cliente" sirve**, o hace falta una remisión formal? *(No existe
   remisión ni packing list.)*
3. **¿Cuántos artículos tiene el conteo físico?** De eso depende si se teclea o se construye un
   importador — **es lo que más puede mover la fecha del arranque**. No existe importación masiva.
4. **¿El nº interno de producción arranca en 1** o se rescata la numeración histórica? Después del
   arranque ya no se puede cambiar.
5. **Los 10 catálogos de uso general** — Daniel eligió la **opción 2** (leer libre, editar con
   permiso). Listo para construir; se resuelve **parejo en los diez**.

---

## 6. La conclusión de fondo

**El sistema está mucho más completo de lo que este documento hace parecer.** Casi ningún hallazgo es
una función que falte: el motor de kardex, el de ruta crítica, el de cotización y el de cuenta
corriente están construidos, y bien construidos. Lo que falta, una y otra vez, es **la puerta**: el
botón que lleva del paso 4 al 5.

Eso es buena noticia. Poner puertas es barato. Y explica por qué al probarlo se siente incompleto
aunque por dentro no lo esté.

---

## 7. Lo que NO se pudo determinar

- **Qué ETL corrió Gabriel realmente en `prueba`** — el repo no lleva bitácora de corridas (los
  `reporte-etl-*.txt` están gitignored). De eso dependen B22 y B23: si los ETL de F5 y F6 ya
  corrieron, ambos bajan de bloqueante a mejora.
- **Si B3 (el PT que no se mueve) falla en la práctica** — razonado del código, no ejecutado.
- **Cuántos clientes y colores activos quedan tras la migración** — los topes de 100 son un riesgo
  comprobado en código, no un hecho observado.
- **Cuánto tarda la corrida completa del ETL** y **cuántos artículos tiene el conteo físico real**.
- Si los **Backups de Railway** están habilitados hoy, y si el bucket de producción ya existe.
- `docs/ESTADO-DESPLIEGUE.md` **no existe**, aunque tres documentos lo citan.
- **Ningún hallazgo se verificó ejecutando la app**: todo es lectura de código, esquema y migraciones.
