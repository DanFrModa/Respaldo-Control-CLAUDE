# PROPUESTA — Facturar desde CONTROL (CFDI 4.0 con timbrado propio) · requisito **R14**

> **Origen:** Daniel, 8-sep-2026: *«creo que ya sabes pero queremos implementar facturación, pero la
> verdad no sé cómo hacerlo, investiga bien bien bien cómo sería todo el proceso»*.
>
> **Qué es este documento.** La investigación completa de **cómo se factura hoy en México** y de **qué
> haría falta para que CONTROL lo haga**, con el inventario honesto de lo que el sistema ya tiene, lo
> que falta, cuánto cuesta, cuánto tarda y **qué decisiones necesito de Daniel**. No es un plan
> aprobado: es el insumo para decidir. Nada de esto está construido.
>
> **Contexto:** R14 (*timbrado nativo vía PAC*) está en el plan desde el día uno como **fase posterior**
> — `DECISIONES.md` D12, `REQUISITOS-NUEVOS.md` §R14, `PLANMAESTRO.md` módulo 14. Hoy CONTROL
> **importa** el XML que se timbra en SINUBE (F9-E4). Esto es el salto de *importar* a *emitir*.

---

## 0. Resumen en una página

**La buena noticia:** el cimiento ya está puesto y no es poco. CONTROL ya sabe **leer** un CFDI 4.0
(parser propio, validado), ya lleva **la cuenta corriente del cliente** (CxC, saldo = Σ movimientos,
cancelación por inverso auditado), ya guarda **archivos en R2**, ya tiene **folios atómicos**, ya
genera **23 impresos PDF**, y ya sabe **qué se le entregó a cada cliente** (la entrega a cliente, que
es el hecho que se factura). Facturar no es empezar de cero: es **cerrar el círculo por el otro lado**.

**La mala:** facturar es **lo único del sistema que está regulado**. Un error aquí no lo paga el
usuario con una molestia; lo paga la empresa con el SAT (multas, deducción rechazada) o con el
cliente (la factura mal hecha no se paga). Y no es *una* función: son **siete piezas obligatorias**
que hay que tener las siete o no se puede operar:

1. Emitir y **timbrar** la factura de venta.
2. **Entregarla** al cliente como él la exija (correo / portal / EDI, y **addenda** si la pide).
3. Emitir el **complemento de pago (REP)** cuando el cliente pague — obligatorio si se vende a
   crédito, y con fecha límite: **el día 5 del mes siguiente al cobro**.
4. **Cancelar y sustituir** cuando algo salió mal (con aceptación del cliente y en el orden correcto).
5. **Notas de crédito** por devoluciones y descuentos.
6. Guardar el **XML** (es el original fiscal; el PDF no vale) y la **representación impresa**.
7. No perder ninguna: bandeja de lo que quedó **sin timbrar** y vigilancia de estatus.

Y aparte, dos que **no aplican siempre pero a FR Moda sí**: la **addenda** de las cadenas que la
exijan *(hoy ninguna activa, pero va a hacer falta)* y la **Carta Porte** cuando se mueva mercancía
propia *(Daniel: «a veces»)*. Ésas van **aparte y después** — son las dos más pesadas.

**Lo que no es código y toma calendario** (se puede empezar HOY, es gratis o casi):
el **CSD** (sello digital, gratis, 24–72 h con la e.firma), el **contrato con un PAC** (días) y las
**constancias de situación fiscal de los clientes** (semanas, depende de ellos).

**Costo de operación:** irrelevante. Con **30–50 facturas al mes** (dato de Daniel) más sus
complementos de pago son ~**100 timbres/mes ≈ 1,200 al año** ⇒ del orden de **$1,000–$3,000 MXN al
año**, según el PAC (§6). Comparado con SINUBE (~$9,450/año por usuario) el ahorro es real, aunque
**SINUBE probablemente no se apague del todo**: el contador sigue necesitando la contabilidad, que
CONTROL no lleva (D12) — lo honesto es decir *«CONTROL factura; el contador contabiliza»*.
🔑 **Y el volumen bajo simplifica el diseño:** no hace falta timbrado masivo, ni colas, ni
reintentos sofisticados. Son unas pocas facturas al día.

**Costo de desarrollo:** ~**8 filas** del tamaño con el que venimos trabajando (unas 6–9 filas de las
que se cierran hoy en 1–3 días cada una), de las cuales **4 son grandes** (el documento factura, el
timbrado, el complemento de pago y —si se mete— la Carta Porte). No hay ninguna pieza imposible; hay
**una pieza delicada** (el timbrado, por el riesgo de timbrar dos veces o de timbrar desde `prueba`).

### ✅ CONFIRMADO POR DANIEL (10-sep-2026) — va DESPUÉS de arrancar

> **Textual, respuesta 11:** *«Después de arrancar. Empezamos facturando en SINUBE y subimos acá las
> facturas.»*

| | Queda así |
|---|---|
| **¿Bloquea la V1?** | **NO.** Confirmado por Daniel. En el arranque se factura en SINUBE y CONTROL **importa el XML** — camino que **ya existe y está en el menú**: `/cxc/importar-cfdi` (permiso `cxc.administrar`, `ImportarCfdiVentaPagina.tsx`) |
| **¿Cuándo?** | **El primer bloque grande después del arranque.** Para entonces las entregas y la CxC ya llevarán meses cargándose bien, que es justo de donde nace la factura |
| **¿Qué empieza ya?** | El **papeleo**, que es calendario y no cuesta desarrollo: **CSD** · **PAC** · **constancias de situación fiscal de los clientes** |
| ⚠️ **Y una prueba que conviene hacer ANTES del arranque** | Importar en `prueba` **una factura real de SINUBE** por esa pantalla. Si algo no cuadra (RFC, formato, conciliación con el pedido), es mucho mejor enterarse ahora que el primer día de operación |

## 1. Cómo funciona facturar en México, en cristiano

Cinco piezas, y conviene no confundirlas porque cada una se tramita distinto:

| Pieza | Qué es | Cómo se consigue |
|---|---|---|
| **RFC + Constancia de Situación Fiscal** | Quién eres ante el SAT: razón social exacta, **régimen fiscal** y **código postal** de tu domicilio fiscal | Ya lo tienes. Lo mismo hace falta **de cada cliente** |
| **e.firma** | Tu identidad digital ante el SAT (la «firma» para trámites) | Ya la tiene la empresa |
| **CSD — Certificado de Sello Digital** | El par de archivos (`.cer` + `.key` + contraseña) **con los que se firma cada factura**. Es lo que dice «esta factura la hice yo» | **Gratis**, en línea, con la app **Certifica** del SAT + la e.firma. Tarda **24–72 h** en liberarse. **Vigencia 4 años** |
| **PAC — Proveedor Autorizado de Certificación** | Una empresa autorizada por el SAT que revisa tu factura, la manda al SAT y le pega el **timbre**. **Sin PAC no hay factura válida**: nadie timbra directo con el SAT | Se contrata. Se pagan **timbres** (~$0.80–$1.00 c/u), a veces con una mensualidad |
| **El timbre (TFD)** | El sello del SAT sobre tu factura, con su **UUID** (folio fiscal). Es lo que la vuelve real | Lo devuelve el PAC en segundos |

**Y lo más importante de entender: el documento fiscal es el XML, no el PDF.** El PDF es solo una
«representación impresa» — bonita, para que la lea un humano. Si el XML se pierde, la factura se
perdió. Por eso todo XML se guarda (en R2, como ya se guardan las fotos y los CFDI de proveedores).

---

## 2. El proceso completo, paso a paso

### Paso 0 — Antes de facturar: los datos fiscales del cliente

Desde el **CFDI 4.0** el SAT **valida contra su propio padrón** que el receptor exista y que sus datos
coincidan **exactamente**: RFC + **nombre/razón social tal cual** + **código postal fiscal** +
**régimen fiscal**. Si algo no coincide —una «S.A. de C.V.» de más, un CP viejo—, **el PAC rechaza la
factura** y no se puede timbrar. No es negociable ni se puede «forzar».

⇒ De cada cliente hace falta su **Constancia de Situación Fiscal** (la que baja del SAT). Es el
trámite más lento del proyecto, porque depende de que el cliente la mande.

Además, por cliente hay que saber: **Uso de CFDI** (normalmente `G01 – Adquisición de mercancías`),
**método de pago** (`PUE` si paga de contado, `PPD` si es a crédito) y **a dónde se le manda** la
factura (correo, portal, EDI).

> 🟢 **Ya hay algo:** la fila **0.119** (leer la constancia de situación fiscal, rescatada por Daniel a
> la V1 el 4-sep para dar de alta proveedores) hace **exactamente** este trabajo. Sirve igual para
> clientes: es la misma constancia y el mismo lector.

### Paso 1 — De dónde nace la factura

Aquí CONTROL tiene una ventaja que casi ningún sistema tiene: **ya sabe qué se entregó**.
`entregas-cliente.ts` registra cada entrega por **modelo × color × talla**, contra la orden y el
pedido, y de ahí sale el *vendido* del EDR (`edr.ts`: ventas = Σ entregas × precio del renglón de
pedido). El precio pactado ya vive en `PedidoLinea.precio` (y las listas de precios de F8).

⇒ **La factura nace de lo entregado**, con un botón. No se recaptura nada. Eso es exactamente lo que
hoy alguien hace a mano en SINUBE mirando la remisión.

> ⚠️ **PERO NO es «una entrega = una factura»** — así lo había supuesto yo y **Daniel lo corrigió**
> (respuestas 4 y 5, 10-sep-2026):
>
> - *«Depende del cliente… pero comúnmente **una por modelo** (a veces **más de una por modelo**).»*
> - *«**C&A es una por pedido** (sin detalle de talla y color).»*
>
> **Dos cosas distintas, y las dos son preferencia DEL CLIENTE:**
>
> | | Qué se decide | Valores |
> |---|---|---|
> | **Cómo se agrupa** | Qué entra en una factura | por pedido · **por modelo** (lo común) · por entrega · a mano |
> | **Qué detalle lleva el renglón** | Cuántos renglones y qué dicen | un renglón total (**C&A**) · por modelo · por modelo+color · por modelo+color+talla |
>
> 🔑 **Y la consecuencia técnica, que no es menor:** si de un mismo modelo pueden salir **varias
> facturas**, el sistema tiene que llevar **cuánto de lo entregado ya se facturó** — un *saldo por
> facturar* por renglón entregado. No es capricho: sin eso se factura dos veces lo mismo, o se queda
> algo sin facturar y nadie se entera. Es la pieza que hace crecer la fila **F-3**… y de paso entrega
> algo que hoy no existe en ningún lado: **«qué entregué y todavía no cobro»**.

### Paso 2 — Se arma el XML

Un CFDI 4.0 de venta lleva, obligatoriamente:

- **Comprobante:** Serie, Folio, Fecha, **LugarExpedicion** (CP de la empresa), Moneda, SubTotal,
  Total, **TipoDeComprobante = I** (ingreso), **Exportacion** (`01 – No aplica` si no exportas),
  **MetodoPago** (`PUE`/`PPD`), **FormaPago** (`03` transferencia… o **`99 – Por definir`** cuando es
  PPD, que es la regla).
- **Emisor:** RFC, Nombre, RegimenFiscal. *(Ya está en `Empresa`: `rfc`, `regimenFiscalSat`,
  `codigoPostalFiscal` — se capturaron para el «documento para facturar» de la fila 0.118.)*
- **Receptor:** RFC, Nombre, **DomicilioFiscalReceptor** (CP), **RegimenFiscalReceptor**, **UsoCFDI**.
  *(Del cliente hoy solo hay `rfc`. **Faltan los otros cuatro**.)*
- **Conceptos**, uno por renglón: **ClaveProdServ** (clave del catálogo del SAT, >50,000 entradas),
  **ClaveUnidad**, Cantidad, Descripcion, ValorUnitario, Importe y **ObjetoImp** (`02 – Sí objeto`
  para ropa). Cada concepto lleva su **IVA 16 %** trasladado.
- **Impuestos** totales.
- Y si el cliente la pide, la **Addenda** (ver Paso 4).

> ⚠️ **La pieza de datos que hoy NO existe en CONTROL:** la **clave de producto/servicio del SAT** y
> la **clave de unidad** por modelo (y por servicio, si se factura maquila). Es un campo nuevo en el
> catálogo de modelos, con un valor por defecto para ropa. Sin eso no se puede armar ningún concepto.

### Paso 3 — Se sella y se timbra

1. CONTROL genera la **cadena original** (una transformación XSLT que publica el SAT).
2. La firma con la **llave privada del CSD** (SHA-256 + RSA, resultado en base64) → ese es el `Sello`.
3. Se manda al **PAC**, que valida ~200 reglas, la registra ante el SAT y devuelve el **Timbre Fiscal
   Digital** con el **UUID**.
4. CONTROL guarda el **XML timbrado en R2**, genera el **PDF** y —esto ya existe— crea el **cargo en
   CxC** del cliente, marcado fiscal, con su UUID.

**Reglas duras que el software tiene que respetar:**

- **72 horas:** entre la `Fecha` del XML y el timbrado no pueden pasar más de **72 h**, y la fecha no
  puede ir adelantada más de **5 minutos**. ⇒ Una factura que se quedó en borrador tres días **hay
  que re-fecharla**, no timbrarla como estaba.
- **Nunca dos veces:** si el PAC responde tarde o se corta la red, el riesgo real es **timbrar dos
  veces la misma venta**. Se resuelve con una llave de idempotencia por factura y consultando al PAC
  antes de reintentar. Es la parte más delicada de todo el desarrollo.
- **`prueba` no puede timbrar de verdad.** Los PAC dan un **ambiente de pruebas** con certificados
  falsos. El ambiente de `prueba` de Railway **tiene que** apuntar ahí, con un candado en código: si
  el sistema no sabe con certeza que es producción, **no timbra**. Una factura timbrada por error
  desde `prueba` es una factura real ante el SAT, con IVA real que declarar.

### Paso 4 — Se le entrega al cliente (y aquí aparece la addenda)

Timbrar no es entregar. Según el cliente:

- **Correo** con XML + PDF: el caso fácil.
- **Portal de proveedores**: se sube el XML. Muchas cadenas lo exigen y es donde nace su
  contra-recibo y su programación de pago.
- **EDI / addenda**: las cadenas grandes exigen una **addenda** — un bloque de datos **suyos** dentro
  del XML (número de orden de compra, número de proveedor, tienda, entrega…). **Cada cadena tiene la
  suya**, definida por ella, con su propio esquema.

> 🔑 **Detalle técnico que da libertad:** la addenda **no forma parte de la cadena original ni del
> sello**, así que se puede **agregar después de timbrar** sin invalidar nada. Es decir: no dependemos
> de que el PAC la soporte; CONTROL puede insertarla él mismo.
>
> ⚠️ **Pero el contenido lo dicta el cliente**, y conseguir su especificación es lo que tarda. **Es la
> pregunta más urgente para Daniel**: de sus clientes de hoy (C&A entre ellos), **¿alguno exige
> addenda o portal?** Si la respuesta es sí, esa parte se planea aparte, cliente por cliente.

### Paso 5 — El cliente paga → **complemento de pago (REP)**

Si se vende **a crédito** (30, 60 días), la factura se emite **PPD**, y entonces **cada cobro obliga a
emitir un CFDI aparte**: el **complemento de pago**, que dice qué facturas se están pagando, con
cuánto, en qué parcialidad y qué saldo queda.

- **Plazo: a más tardar el día 5 del mes siguiente** al que se recibió el pago (días naturales; en
  2026 **no hay prórroga**).
- Se puede juntar varios pagos en un solo REP.
- Desde 2026 **cancelar un REP ya no es directo**: requiere aceptación del receptor, sin importar el
  monto.

> ⚠️ **El hueco concreto en CONTROL:** hoy CxC registra el cobro como un movimiento que baja el saldo,
> pero **no se aplica a facturas concretas** (no hay «este cobro paga estas tres facturas»). Para el
> REP eso es obligatorio. ⇒ Es una fila propia: **aplicación de cobros a facturas**. Y de paso arregla
> algo que el negocio ya quiere: saber qué factura sigue sin pagarse, no solo el saldo global.

### Paso 6 — Cuando algo sale mal

| Caso | Qué se hace | Regla que hay que respetar |
|---|---|---|
| **Factura con error** (precio, cantidad, datos del cliente) | Se emite **la nueva primero**, relacionada con la vieja (**relación tipo 04 – Sustitución**), y **después** se cancela la vieja con **motivo 01**, apuntando al UUID de la nueva | El orden **no** se puede invertir: el motivo 01 exige el UUID del sustituto |
| **Factura duplicada** | Cancelación **motivo 02** | — |
| **No se llevó a cabo la operación** | Cancelación **motivo 03** | — |
| **Operación nominativa en una factura global** | Motivo 04 | No aplica aquí (es de mostrador) |
| **Devolución / descuento posterior** | **Nota de crédito** (CFDI de **egreso**), relacionada a la factura original | No se cancela la factura buena: se le resta con la nota |

**Y la regla que más duele si se ignora:**
- Cancelar **requiere la aceptación del cliente** (le llega a su Buzón Tributario; tiene **3 días
  hábiles** y si no contesta se cancela por plazo vencido). **Excepción:** dentro de las **24 h**
  siguientes a emitirla, se cancela sin pedir permiso. ⇒ *si te equivocaste, cancélala hoy.*
- **Fecha límite para cancelar:** hasta el **31 de marzo del año siguiente** (persona moral: el mes de
  la declaración anual). Después, **ya no se puede por ningún medio** — la factura mala queda para
  siempre, con su IVA. ⇒ El sistema debe **avisar en enero–marzo** de lo que quedó sin corregir del
  año pasado.

> 🟢 **Aquí CONTROL ya juega con ventaja:** cancelar en CxC ya es un **movimiento inverso auditado**
> (nunca se edita ni se borra, D3). Lo único nuevo es que además hay que **avisarle al SAT** y esperar
> la respuesta del cliente — o sea, la factura tiene **estatus** (`vigente / en proceso de cancelación
> / cancelada`) que hay que consultar periódicamente.

---

## 3. Los casos especiales que sí pueden tocarle a FR Moda

| Caso | Qué implica | ¿Aplica? |
|---|---|---|
| 🔴 **Traslado de mercancía propia — Carta Porte 3.1** | Si la mercancía se mueve **en vehículo propio** por carretera **federal**, hay que emitir un CFDI de **traslado con complemento Carta Porte**. Multas de hasta ~$97,330 por documento. **Excepción:** vehículo ligero (menor a un C2) y **menos de 30 km de tramo federal**, o cuando se tiene la certeza de no pisar carretera federal → basta el CFDI de traslado **sin** complemento | ✅ **SÍ APLICA** — Daniel (respuesta 7): *«sí necesito a veces hacer carta porte»*. **Es el complemento más pesado de todos** (ubicaciones origen/destino con fechas, distancia, mercancías con su clave y peso, datos del vehículo, permiso SCT, seguro, y el operador con su licencia) ⇒ **fila propia y NO en la primera entrega**: mientras tanto se sigue haciendo donde se hace hoy |
| **Exportación** | Si se factura al extranjero: `Exportacion = 02` + **Complemento de Comercio Exterior** + pedimento. Es un mundo aparte | ❌ **NO** (Daniel, respuesta 6) ⇒ `Exportacion = 01` siempre |
| **Facturar en dólares** | Se puede (`Moneda = USD` + `TipoCambio`), pero obliga a decidir el tipo de cambio y complica la CxC | ❌ **NO** (respuesta 6). **Solo MXN** ⇒ el módulo se simplifica bastante |
| **Anticipos** | Si el cliente adelanta dinero, hay un procedimiento propio del SAT (factura de anticipo + egreso al facturar el total) | ❌ **No se usan** (no se preguntó de nuevo; se mantiene fuera hasta que Daniel lo pida) |
| **Venta de retazo, avíos, segundas, maquila a terceros** | Son ventas que **no nacen de una entrega de orden** ⇒ hace falta una **factura libre** (capturada a mano) además de la que nace de la entrega | ✅ **SÍ** — Daniel (respuesta 8): *«muy pocas veces pero sí puede pasar»*. Al ser raro, basta la captura a mano: **no** se le construye automatismo |
| **Retenciones** | Vendiendo mercancía de empresa a empresa **no hay retención**. (Las retenciones aparecen al *recibir* servicios de personas físicas, y eso ya lo lee el parser de CxP) | No aplica |

---

## 4. Qué ya tiene CONTROL (medido en el código, no supuesto)

| Pieza | Dónde vive | Qué tan lejos llega |
|---|---|---|
| **Leer un CFDI 4.0** | `backend/src/dominio/terceros/cfdi/parser-cfdi.ts` | Parser propio y endurecido: valida versión, timbre, UUID, emisor/receptor, conceptos, IVA y retenciones. **Emitir usa la misma gramática al revés** |
| **Importar la venta ya timbrada → CxC** | `.../cfdi/cfdi-ventas.ts` | Ya concilia cliente por RFC, liga pedido, sube el XML a R2 y crea el cargo fiscal. **El día que CONTROL timbre, este es el mismo camino con la factura naciendo aquí** |
| **La cuenta del cliente** | `.../terceros/cuenta-terceros.ts`, `.../cxc/cxc.ts` | Saldo = Σ movimientos (D3), UUID único global, cancelación por inverso auditado, aging por días de crédito, vista fiscal para el contador |
| **Qué se le entregó al cliente** | `backend/src/dominio/produccion/entregas-cliente.ts` | Por modelo × color × talla, contra orden y pedido, con kardex. **Es el origen natural de la factura** |
| **El precio** | `PedidoLinea.precio` + listas de precios de F8 | Ya es el precio que usa el EDR para calcular ventas |
| **Datos fiscales de la empresa** | `Empresa.rfc`, `.regimenFiscalSat`, `.codigoPostalFiscal` | Los tres que el CFDI exige del emisor. **Ya están** (fila 0.118) |
| **Folios sin huecos ni choques** | `Secuencia` (A3) | Serie+folio de facturas se resuelve con el mismo motor que OP/OC |
| **Archivos** | `backend/src/comun/archivos.ts` (R2) | El XML timbrado y el PDF se guardan igual que los CFDI de proveedores |
| **PDF** | 23 impresos con `@react-pdf/renderer` | La representación impresa es un impreso más (le falta el **QR** y los sellos) |
| **Permisos, auditoría, transacciones, multi-empresa** | A1–A9 | Ya resueltos para todo el sistema |

**Traducción:** de las diez cosas que hacen falta para facturar, **seis ya están hechas** por otras
razones. Lo que falta es lo específicamente fiscal.

---

## 5. Qué falta exactamente

**Datos que hoy no existen:**
1. Del **cliente**: nombre fiscal exacto, **CP fiscal**, **régimen fiscal**, **uso de CFDI**, método
   de pago por defecto, correo(s) de facturación, y **cómo entrega la factura** (correo/portal/EDI +
   addenda). *(Hoy solo hay `rfc` y `diasCredito`.)*
2. Del **modelo/servicio**: **ClaveProdServ** y **ClaveUnidad** del SAT.
3. **Catálogos del SAT** sembrados: formas de pago, usos de CFDI, regímenes, monedas, unidades,
   motivos de cancelación, tipos de relación. *(Son semillas; el SAT los actualiza varias veces al
   año — enero, marzo, abril y julio de 2026 hubo cambios.)*

**Piezas de software que no existen:**
4. El **documento Factura** (serie, folio, estatus, UUID, relación con entregas, borrador→timbrada).
5. El **adaptador del PAC** + la **bóveda del CSD** (llave privada cifrada, nunca en el repo).
6. La **representación impresa fiscal** (QR de verificación, sello del CFDI, sello del SAT, cadena
   original del complemento de certificación).
7. La **cancelación fiscal** (motivos, sustitución, consulta de estatus, aceptación del receptor).
8. La **aplicación de cobros a facturas** y el **complemento de pago (REP)** con su calendario del
   día 5.
9. La **addenda** por cliente (solo para los que la exijan).
10. La **bandeja de vigilancia**: qué quedó sin timbrar, qué está en proceso de cancelación, qué
    factura vence el plazo de cancelación.

---

## 6. Las dos maneras de construirlo (y cuál recomiendo)

| | **A) PAC que también sella** (Facturapi, Facturama, FiscalAPI…) | **B) Sellamos nosotros y el PAC solo timbra** (SW, Finkok…) |
|---|---|---|
| Cómo funciona | CONTROL manda los datos; el PAC arma el XML, lo sella con **nuestro CSD cargado en su bóveda** y lo timbra | CONTROL arma el XML, calcula la cadena original (XSLT del SAT), **firma con el CSD que guardamos nosotros** y manda el XML sellado |
| A favor | Mucho menos código. **Ellos siguen los cambios de catálogos y reglas del SAT**, que cambian varias veces al año | Control total. El CSD **nunca sale de nuestra infraestructura**. Cambiar de PAC es trivial |
| En contra | Dependencia de un tercero; la llave privada vive en su bóveda | En Node no hay un procesador **XSLT 1.0** confiable sin dependencias nativas ⇒ la cadena original es un problema técnico real, y **cada cambio del SAT es trabajo nuestro** |
| Costo | Timbre + a veces mensualidad | Timbre (suele ser más barato) |

### ✅ Recomiendo **A**, con tres condiciones innegociables

1. **El PAC va detrás de un adaptador** (`dominio/facturacion/pac/`), con la lógica de negocio de
   nuestro lado (A1). Cambiar de proveedor debe ser cambiar una implementación, no reescribir el
   módulo.
2. **CONTROL es el dueño del dato**: la serie y el folio los pone CONTROL (secuencia atómica A3),
   nunca el PAC; y el **XML timbrado se guarda en R2** siempre. Si mañana el PAC desaparece, los
   comprobantes siguen siendo nuestros.
3. **Candado de ambiente**: `prueba` → sandbox del PAC, siempre; producción → real. Con una prueba
   automática que falle si alguien lo afloja.

**La razón de fondo:** el SAT cambió catálogos **cuatro veces en lo que va de 2026**. Un equipo chico
no debe estar persiguiendo eso; para eso se paga un PAC. Lo que sí debe ser nuestro es **el proceso
del negocio** — de qué entrega nace la factura, quién la autoriza, cómo se cobra.

### Las opciones concretas (Daniel, respuesta 12: *«no tengo idea… danos opciones»*)

**Con el volumen real — 30-50 facturas/mes + sus complementos de pago ≈ 100 timbres/mes ≈ 1,200 al
año — el costo del timbre es simbólico y NO debe decidir.** Lo que decide es: (1) que tenga
**addenda** resuelta *(Daniel: eventualmente la va a necesitar)*, (2) que tenga **Carta Porte 3.1**
*(Daniel: a veces la necesita)*, (3) que tenga **ambiente de pruebas** de verdad, y (4) que la API sea
sensata para integrar.

| PAC | Costo *(publicado; hay que cotizar)* | Addenda | Carta Porte | Nota |
|---|---|---|---|---|
| **Facturama** ⭐ | API **$1,650 MXN/año** con 100 folios; folios extra **desde $0.50** | **Sí, producto aparte (~$600 único, ilimitadas)** | **Sí (~$1,400 único, +25 folios)** | Es el que cubre **las cuatro** necesidades sin sorpresas y con el costo más bajo a este volumen. Sandbox público. Mexicana, 15 años |
| **Facturapi** | Suscripción **desde $299 MXN/mes** + consumo | Sí | Sí | La API más agradable para desarrollar. A 100 timbres/mes la mensualidad pesa más que el consumo |
| **FiscalAPI** | **$199 MXN/mes** + paquetes | Sí | Sí | Multi-RFC nativo, SDKs en varios lenguajes |
| **Finkok** | **~$0.30 + IVA por timbre**, sin mensualidad | — | Sí | El más barato, pero es de **bajo nivel**: *nosotros* tendríamos que sellar el XML ⇒ el problema del XSLT (§6, opción B) |
| **Facty** | **desde $0.80/timbre**, sin mensualidad, 10 gratis | — | — | Sencillo; se queda corto para addenda |

**Recomendación: Facturama**, por costo a este volumen y porque **addenda y Carta Porte ya son
productos suyos** — las dos cosas que Daniel dijo que va a necesitar. Con el adaptador de §6 detrás,
cambiar de PAC después sigue siendo barato.

⚠️ **Los precios son los publicados en sus sitios y cambian.** Antes de firmar hay que cotizar los
tres puntos: precio real del timbre a 1,200/año, **si la addenda que necesitemos ya la tienen hecha**
(no todas las cadenas están en el catálogo de todos los PAC), y **si el sandbox permite probar
cancelación y complemento de pago**, no sólo emisión.

---

## 7. Riesgos, y cómo se protege cada uno

| Riesgo | Consecuencia real | Protección |
|---|---|---|
| **Timbrar dos veces** la misma venta | Dos facturas reales al cliente; IVA duplicado; cancelar una con su papeleo | Llave de idempotencia por factura + consulta al PAC antes de reintentar + candado en base |
| **Timbrar desde `prueba`** | Facturas reales sin querer, con su IVA a declarar | Ambiente sandbox + guarda dura + prueba automática |
| Se cae el PAC | Se para la facturación | La factura queda **en borrador** con bandeja de pendientes; se re-fecha y se timbra después (ojo con las **72 h**) |
| Datos del cliente mal | El PAC rechaza; el cliente no paga | Validar contra la constancia (fila 0.119) **antes** de facturar, no al timbrar |
| Se pasa el día 5 sin emitir REP | Multa e IVA en el mes equivocado | Bandeja de cobros sin complemento con cuenta regresiva |
| Se pasa el 31 de marzo con una factura mala | **Ya no se puede cancelar nunca** | Aviso desde enero de lo pendiente del año anterior |
| **El CSD vence a los 4 años** | Se detiene la facturación de golpe | Aviso con 60 días de anticipación |
| El cliente exige addenda y no la conocíamos | La factura se rechaza en su portal y **no se paga** | Preguntarlo **ahora**, no al final |

---

## 8. Plan por etapas (ajustado con las respuestas de Daniel, 10-sep-2026)

> Numeración tentativa a partir de la última fila del programa (0.163). Cada fila = 1 coder + 1
> reviewer, como todo lo demás. **Todo esto arranca DESPUÉS del go-live** (respuesta 11).

| # | Fila | Tamaño | Depende de |
|---|---|---|---|
| **F-1** | **Los datos fiscales del cliente** — nombre fiscal, CP, régimen, uso de CFDI, método de pago, correos, **cómo se agrupa su factura y con qué detalle** (respuestas 4 y 5), y la casilla *«pide addenda»* apagada por ahora. Reusa el lector de constancias (0.119) | mediana | 0.119 |
| **F-2** | **Catálogos del SAT + clave de producto/unidad por modelo** (semilla + captura + default para ropa) | chica | — |
| **F-3** | ⭐⭐ **El documento Factura** — se arma escogiendo **qué se factura de lo entregado**, con **saldo por facturar** por renglón, agrupación y detalle **según el cliente**, serie/folio, IVA, totales; **todavía sin timbrar**. Incluye la **factura libre** (respuesta 8) | **grande** ⬆ *(creció: era «nace de la entrega», y no lo es)* | F-1, F-2 |
| **F-4** | ⭐⭐ **Timbrado** — adaptador del PAC, bóveda del CSD, candado de ambiente, idempotencia, XML a R2, cargo automático en CxC | **grande** | F-3 + PAC contratado + CSD |
| **F-5** | **Representación impresa + envío** — PDF fiscal con QR y sellos, correo al cliente con XML+PDF | mediana | F-4 |
| **F-6** | **Cancelación y sustitución** — motivos, relación 04, estatus, consulta al SAT, inverso en CxC. El permiso `facturas.cancelar` nace **suelto**, para que Daniel lo prenda y apague desde `/administracion/roles` **en el celular** (respuesta 10) | mediana | F-4 |
| **F-7** | ⭐ **Cobros aplicados a facturas + complemento de pago (REP)** con la bandeja del día 5 | **grande** | F-4 |
| **F-8** | **Nota de crédito** (devoluciones y descuentos) | chica | F-4 |
| **F-9** | ⏸️ **Addendas** — *aparcada*: hoy **ningún cliente activo la pide**, pero Daniel la va a necesitar (respuesta 2). El diseño le deja el hueco desde F-1; se construye **cuando aparezca el cliente que la exija**, con su especificación en la mano | ? | Que el cliente mande su especificación |
| **F-10** | ⏸️ **Carta Porte 3.1** — *aparcada, fila propia*: Daniel la necesita **a veces** (respuesta 7). Es el complemento más pesado del SAT y el de multa más alta ⇒ **no se mete junto con el resto**; mientras tanto se sigue haciendo donde se hace hoy | **grande** | F-4 + decidir vehículo propio vs. transportista |
| **F-11** | *(opcional)* **Descarga masiva del SAT** — bajar automáticamente los CFDI emitidos y recibidos para conciliar y detectar cancelaciones | mediana | — |

**El mínimo para dejar de facturar en SINUBE es F-1 → F-8.** F-9 y F-10 son **posteriores y con
disparador propio** (que un cliente pida addenda; que se decida meter Carta Porte).

**En paralelo, sin código:** CSD · contrato con el PAC · constancias de los clientes · avisarle al
contador · confirmar la serie.

---

## 9. Las respuestas de Daniel (10-sep-2026) y lo que cambió

| # | Pregunta | ✅ Respuesta de Daniel | Efecto en el plan |
|---|---|---|---|
| 1 | ¿Cuántas facturas al mes? | **30–50** | El costo del timbre es **simbólico** (~$100/mes). **No hace falta** timbrado masivo ni colas: el diseño se simplifica |
| 2 | ¿Addenda o portal? | *«Sí, hay clientes que sí. Pero ahorita no tengo ninguno activo, pero eventualmente lo voy a necesitar»* | **Addenda NO entra** en la primera entrega ⇒ fila **F-9** aparcada. Pero **sí pesa en la elección de PAC** (§6) y el hueco se deja desde F-1 |
| 3 | ¿A crédito? | **Sí** | **PPD ⇒ complemento de pago obligatorio.** F-7 es parte del mínimo, no un extra |
| 4 | ¿Cómo se agrupa la factura? | *«Depende del cliente… comúnmente **una por modelo** (a veces más de una por modelo)»* | 🔴 **Mi default estaba mal.** Agrupación **configurable por cliente** + **saldo por facturar** ⇒ **F-3 crece** |
| 5 | ¿Qué detalle lleva el renglón? | *«Depende del cliente. **C&A es una por pedido** (sin detalle de talla y color)»* | Nivel de detalle del renglón **configurable por cliente** (4 valores) |
| 6 | ¿Exporta / dólares? | **No** | `Exportacion = 01`, **solo MXN**. Fuera comercio exterior y tipo de cambio |
| 7 | ¿Carta Porte? | *«Sí necesito a veces hacer carta porte»* | 🔴 **Nuevo:** fila **F-10**, propia y aparcada. Es el complemento más pesado y el de multa más alta |
| 8 | ¿Ventas fuera de orden? | *«Muy pocas veces pero sí puede pasar»* | **Factura libre** dentro de F-3. Al ser raro, **sin automatismo** |
| 9 | ¿Serie? | *«Sí, podemos hacer una nueva serie. Ejemplo **C1000** (ahí empezamos)»* | Se propone **Serie `C` + folio inicial `1000`** ⇒ se lee `C1000`, `C1001`… (en el CFDI son dos campos). Mismo patrón que el «salto de escalón» de OP/OC. **A confirmar** |
| 10 | ¿Quién factura y cancela? | *«Administración hace facturas y sí le he dado permiso de cancelar… pero estaría bien yo poder dar ese permiso desde mi cel»* | ✅ **Sale gratis:** ya existe `/administracion/roles` (permiso `roles.administrar`). `facturas.cancelar` nace **suelto** y se prende/apaga desde ahí. Sólo hay que **revisar esa pantalla en celular** |
| 11 | ¿V1 o después? | *«Después de arrancar. Empezamos facturando en SINUBE y subimos acá las facturas»* | ✅ **Confirma la recomendación.** El camino del arranque **ya existe**: `/cxc/importar-cfdi` |
| 12 | ¿Qué PAC? | *«No tengo idea… danos opciones»* | Opciones y recomendación en **§6** (recomendado: **Facturama**, por addenda + carta porte + costo a este volumen) |

### 🔴 Lo que estas respuestas dejaron abierto (3 preguntas nuevas)

| # | Pregunta | Por qué importa | Default que propongo |
|---|---|---|---|
| **N1** | **Carta Porte: ¿la mercancía la mueves en camioneta/camión TUYO, o contratas transportista?** ¿Cuántas al mes? ¿Dónde la haces hoy? | Decide **quién** emite: si es tuyo, tú emites un CFDI de **traslado**; si contratas, **el transportista** emite el suyo y tú puede que no necesites nada. Y si el recorrido no pisa carretera federal (o son <30 km de tramo federal en vehículo ligero), **hay excepción** | Que sea **vehículo propio en trayectos cortos** ⇒ F-10 se construye, pero **al final** |
| **N2** | **Serie `C` + folio desde `1000`** (se lee `C1000`) — ¿así? | Es lo único del arranque que **no se puede cambiar después** sin ensuciar la numeración | **Sí** |
| **N3** | ⭐ **¿Me puedes mandar 2 o 3 XML de facturas reales de SINUBE?** Una de **C&A** y una de otro cliente | **Es lo que más tiempo ahorra de todo.** Con el XML real se ve exactamente cómo están armados hoy los renglones de C&A, qué clave de producto usan, qué uso de CFDI, cómo viene el pedido referenciado… **se calca en vez de adivinarse** | — (lo pido cuando puedas) |

## 10. Lo que este documento NO propone

- **Contabilidad** (pólizas, balanza, DIOT, declaraciones): sigue con el contador. D12 no cambia.
- **Nómina** ni recibos de nómina.
- **Conciliación bancaria** completa.
- **Facturación al público en general** (mostrador, factura global): FR Moda vende a empresas.

---

## Fuentes consultadas

- [Anexo 20 / guía de llenado CFDI 4.0](https://siemprealdia.co/mexico/fiscal/anexo-20-sat-cfdi-4-0/) ·
  [CFDI 4.0 guía 2026](https://tesio.com.mx/blog/cfdi-40-guia-completa/) ·
  [cambios de catálogos 2026](https://llbsolutions.com/es/sat-actualiza-catalogos-de-cfdi-4-0-cambios-vigentes-desde-el-30-de-enero-de-2026/)
- [Cadena original y sello (XSLT, SHA-256, RSA, base64)](https://solucionfactible.com/sfic/capitulos/timbrado/cadena_original.jsp) ·
  [XSLT oficial del SAT](http://www.sat.gob.mx/sitio_internet/cfd/4/cadenaoriginal_4_0/cadenaoriginal_4_0.xslt)
- [Regla de las 72 horas para timbrar](https://www.facturadorelectronico.com/blog/2025/03/como-timbrar-una-factura-pasadas-las-72-horas-todo-lo-que-necesitas-saber.html)
- [Certificado de Sello Digital: trámite y vigencia](https://www.docdigitales.com/guias-practicas/manuales/como-tramitar-certificado-sello-digital-sat)
- [Complemento de pago 2026: plazos y cancelación](https://tesio.com.mx/blog/complemento-pago-2026-cambios/) ·
  [cancelación de REP con aceptación](https://contadormx.com/cancelacion-cfdi-complemento-de-pago-sat-2026/)
- [Cancelación de CFDI 2026: motivos y plazos](https://contadormx.com/cancelacion-de-cfdi-en-2026/) ·
  [sustitución con motivo 01](https://www.facturapi.io/blog/cfdi-substitution-reason-01-cancellation) ·
  [plazo hasta la declaración anual](https://cga-asociados.com/blogs/316)
- [Qué es una addenda y cómo funciona](https://facturama.mx/blog/que-es-una-addenda-y-como-funciona-en-mexico/) ·
  [addenda en el XML](https://sw.com.mx/blog/gestion-de-cfdi/addenda-en-el-sat-que-es-y-por-que-incluirla-en-tus-cfdi)
- [Carta Porte 3.1 en 2026](https://facture.com.mx/carta-porte-3-1-2026-cumplir-sin-multas/) ·
  [excepción de los 30 km / tramo local](https://soltum.com.mx/cuando-un-tramo-es-federal-y-cuando-local-para-la-carta-de-porte/)
- PAC y costos: [Facturapi](https://www.facturapi.io/) · [Facturama](https://facturama.mx/api-facturacion-electronica) ·
  [FiscalAPI](https://fiscalapi.com/) · [SW sapien](https://developers.sw.com.mx/knowledge-base/servicio-de-timbrado/) ·
  [comparativa de precios de timbres](https://facty.mx/)
- [Descarga masiva de CFDI del SAT (WS 1.5)](https://contadormx.com/nuevo-web-service-del-sat-1-5-descarga-masiva-de-xml/)
- [SINUBE — precios y módulos](https://www.sinube.mx/precios-sinube)
