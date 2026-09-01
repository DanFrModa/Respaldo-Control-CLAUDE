import { expect, test, type APIRequestContext } from '@playwright/test';

import { generarAbreviaturaCliente } from './abreviatura';
import { crearColorYTalla, elegirCliente, entrarComoAdmin } from './ayudas';

/**
 * E2E del FLUJO NUEVO de Pedidos (rediseño R3, §4.1) contra el stack real:
 *
 *  1. Se siembran cliente (CON abreviatura) + departamento + proyecto + DESARROLLO CON MODELO
 *     NUEVO (F8 + V1-E3n, vía UI) y color + talla (`crearColorYTalla`, lección F5-E4: la matriz
 *     los necesita ANTES).
 *  2. CONSTRUCTOR "Nuevo pedido interno": cliente (combobox) + fecha de entrega + OC del cliente +
 *     renglón con el SELECTOR de desarrollos (búsqueda server-side) → folio `-F` automático.
 *  3. La tabla AGRUPADA muestra el pedido con su chip de OC y el renglón con "Generar OP".
 *  4. "GENERAR OP": aquí NACE la matriz color×talla → al confirmar, la OP sale a producción con su
 *     nº interno de producción y el snapshot de la OC, y su Ruta Crítica se PROGRAMA SOLA (outbox,
 *     B5) — se verifica con un poll sobre la pantalla de la RC de la orden (el consumidor corre en
 *     el backend del compose; se le da margen).
 *  5. La edición fina F2 sigue viva en /pedidos/administrar (pedido real con réplica de renglones).
 *
 * ⚠️ **Por qué el modelo NACE en Desarrollo y no en `/modelos` (V1-E3n; revisado en V1-E8j).** El
 * título de la prueba promete "OP con nº de producción", y ese número sólo existe si el modelo se
 * PROMUEVE al generar la OP. Desde §Post-F9.134 un modelo dado de alta en `/modelos` **también**
 * nace en desarrollo —el alta directa de modelo de producción se retiró—, así que ya no es "no hay
 * nada que promover"; lo que sigue igual es lo otro: un modelo de desarrollo no se puede numerar
 * sin sus DOS dígitos —concepto (tipo de prenda) y género (§Post-F9.83)—, y el alta del catálogo
 * NO los exige, así que un modelo dado de alta ahí sin ellos haría fallar la promoción. El camino
 * que usa el negocio es el que se prueba: el desarrollo con "Crear un modelo nuevo", que exige tipo
 * de prenda + género y arma el código `ABR-26-71-001` con la abreviatura del cliente. Por eso el
 * cliente se captura CON abreviatura: sin ella el sistema se niega a armar el código (y hace
 * bien).
 */
test.describe('Pedidos (rediseño R3, §4.1)', () => {
  test('constructor → tabla agrupada → Generar OP con matriz → OP con nº de producción + OC snapshot + RC sola', async ({
    page,
  }) => {
    test.setTimeout(180_000); // flujo largo: siembra + constructor + OP + poll de la RC.
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `Cliente Flujo ${sufijo}`;
    const departamento = `NIÑOS ${sufijo}`;
    const nombreProyecto = `Joggers ${sufijo}`;
    const ocCliente = `OC-E2E-${sufijo}`;
    // Abreviatura del cliente = el "CYA" de `CYA-26-71-001`: EXACTAMENTE 3 letras A–Z
    // (§Post-F9.112) y ÚNICA en el catálogo (el backend la exige libre). Sigue saliendo del reloj
    // —no del `sufijo`— porque un choque aquí no da un nombre feo sino un 409, pero el margen
    // ENCOGIÓ al apretarse la regla: de ~17 h (5 caracteres en base 36) a **~17.6 s** (26³ =
    // 17,576 valores a resolución de milisegundo). Basta porque la BD de CI nace vacía, este spec
    // crea UN solo cliente y el seed no siembra abreviaturas. El porqué completo, y cuándo deja de
    // bastar, en `./abreviatura`.
    const abreviatura = generarAbreviaturaCliente();
    // Los DOS dígitos de la nomenclatura (§Post-F9.83), tal como los ofrece el diálogo: el 1º sale
    // del tipo de prenda y el 2º del género. De ellos salen tanto el `-71-` del código de
    // desarrollo como los dos primeros dígitos del nº de producción (`71001`).
    const tipoPrenda = 'Pantalón (7)';
    const genero = 'Caballero';
    const par = '71';
    const anioCodigo = String(new Date().getFullYear() % 100).padStart(2, '0');

    await entrarComoAdmin(page);
    const { color, talla } = await crearColorYTalla(page, sufijo);

    // ── Cliente + departamento (el desarrollo cuelga de Cliente+Departamento) ───
    await page.goto('/catalogos/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    // La ABREVIATURA no es adorno: sin ella `mintearCodigoDesarrollo` se niega a armar el código
    // del modelo nuevo ("no tiene ABREVIATURA capturada"). Por id, como el resto de campos cuyo
    // label no es único a prueba de substring.
    await page.getByRole('dialog').locator('#cliente-abreviatura').fill(abreviatura);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();
    await page.getByTestId('buscar-cliente').fill(cliente);
    await page.getByTestId('fila-cliente').filter({ hasText: cliente }).first().click();
    await page.getByTestId('nuevo-departamento').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(departamento);
    await page.getByTestId('guardar-departamento').click();
    await expect(page.getByText(`Departamento "${departamento}" agregado.`)).toBeVisible();

    // ── Proyecto + desarrollo CON MODELO NUEVO (F8 + V1-E3n) ────────────────────
    await page.goto('/desarrollo');
    // R9 fidelidad: la lista de proyectos es tabla-first con el título del proto `vPrecosteosLista`.
    await expect(page.getByRole('heading', { name: 'Pre-costeos', exact: true })).toBeVisible();
    await page.getByTestId('nuevo-proyecto').click();
    const dialogoProyecto = page.getByRole('dialog');
    await elegirCliente(page, dialogoProyecto, cliente, 'proyecto-cliente');
    await dialogoProyecto.getByLabel('Departamento').selectOption({ label: departamento });
    await dialogoProyecto.getByLabel('Nombre / tema').fill(nombreProyecto);
    await page.getByTestId('guardar-proyecto').click();
    await expect(page.getByText(/Proyecto \d+ creado\./)).toBeVisible();
    await page.getByTestId('fila-proyecto').filter({ hasText: nombreProyecto }).first().click();
    const detalleProyecto = page.getByTestId('detalle-proyecto');
    await detalleProyecto.getByTestId('agregar-desarrollo').click();
    const dialogoDesarrollo = page.getByRole('dialog');
    // ⭐ El modelo NACE aquí, de DESARROLLO. El diálogo pide tipo de prenda y género porque de esos
    // dos dígitos cuelga toda la nomenclatura; el CÓDIGO ya no se teclea, lo arma el sistema.
    await dialogoDesarrollo.locator('#desarrollo-modo').selectOption('nuevo');
    await dialogoDesarrollo
      .getByTestId('desarrollo-tipo-producto')
      .selectOption({ label: tipoPrenda });
    await dialogoDesarrollo.getByTestId('desarrollo-genero').selectOption({ label: genero });
    await page.getByTestId('guardar-desarrollo').click();
    // El toast trae el código armado (`DialogoDesarrollo.tsx` ~L111: «Desarrollo agregado como
    // ABR-26-71-001.»), que es la única forma de conocerlo: nadie lo tecleó.
    const avisoDesarrollo = page.getByText(/Desarrollo agregado como \S+\./);
    await expect(avisoDesarrollo).toBeVisible();
    const codigoDesarrollo =
      /Desarrollo agregado como (\S+)\./.exec((await avisoDesarrollo.textContent()) ?? '')?.[1] ??
      '';
    // Y se exige que lo haya armado con las CUATRO piezas: abreviatura del cliente + año de
    // entrega + el par tipo/género + consecutivo de 3. Se pondría roja, por ejemplo, si el código
    // volviera a salir con el par de otro modelo o sin la abreviatura de ESTE cliente.
    expect(codigoDesarrollo).toMatch(
      new RegExp(`^${abreviatura}-${anioCodigo}-${par}-\\d{3}$`, 'u'),
    );

    // ── Constructor "Nuevo pedido interno" (selector de DESARROLLOS, sin matriz) ─
    await page.goto('/pedidos');
    await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
    await page.getByTestId('nuevo-pedido').click();
    const constructor = page.getByTestId('constructor-pedido');
    await expect(constructor.getByRole('heading', { name: 'Nuevo pedido interno' })).toBeVisible();

    // Cliente por combobox (typeahead server-side).
    await constructor.getByTestId('constructor-cliente-input').fill(cliente);
    await page.getByTestId('constructor-cliente-opcion').first().click();
    // Fecha de entrega HOY (cae en el mes/año de los filtros por defecto) + OC del cliente.
    await constructor.getByTestId('constructor-fecha').fill(fechaRelativa(0));
    await constructor.getByTestId('constructor-oc').fill(ocCliente);
    // Renglón: el modelo se elige del SELECTOR de desarrollos (nombre + proyecto/cliente).
    await constructor.getByTestId('constructor-desarrollo-input').fill(codigoDesarrollo);
    const opcion = page.getByTestId('constructor-desarrollo-opcion').first();
    await expect(opcion).toContainText(nombreProyecto); // muestra proyecto/cliente
    await opcion.click();
    await constructor.getByTestId('constructor-cantidad').fill('60');
    await constructor.getByTestId('constructor-precio').fill('148');
    await expect(constructor.getByTestId('constructor-total')).toContainText('60');
    await page.getByTestId('confirmar-constructor').click();
    await expect(page.getByText(/Pedido \d+-F creado/)).toBeVisible();

    // ── Tabla agrupada: cabecera `-F` con chip de OC + renglón con "Generar OP" ──
    const grupo = page.getByTestId('pedidos-grupo').filter({ hasText: cliente }).first();
    await expect(grupo).toBeVisible();
    await expect(grupo.getByTestId('pedidos-chip-oc')).toContainText(ocCliente);
    const renglon = grupo.getByTestId('pedidos-renglon').filter({ hasText: codigoDesarrollo });
    await expect(renglon).toBeVisible();

    // ── Generar OP: aquí NACE la matriz color×talla ─────────────────────────────
    await renglon.getByTestId('pedidos-generar-op').click();
    const panelOp = page.getByTestId('panel-generar-op');
    await expect(panelOp.getByRole('heading', { name: /Generar OP/ })).toBeVisible();
    // La cadena de trazabilidad enseña la OC y el pedido; la OP está "por generar".
    await expect(panelOp.getByTestId('traza-oc')).toContainText(ocCliente);
    await expect(panelOp.getByTestId('traza-op')).toContainText('por generar');

    // ⭐ V1-E3n (§Post-F9.34 punto 4 + §Post-F9.46): el modelo del renglón TODAVÍA es de
    // desarrollo, así que el panel pide CONFIRMAR su nº de producción — y llega YA PROPUESTO
    // ("habíamos acordado que el sistema iba a proponer un modelo de producción y yo sólo lo
    // confirmaría"). Los DOS primeros dígitos tienen que ser el par del catálogo (Pantalón 7 +
    // Caballero 1); los otros tres son el consecutivo libre más bajo de esa serie, que depende de
    // lo que ya haya en la base y por eso se LEE en vez de darse por sabido.
    await expect(panelOp.getByTestId('confirmar-numero-produccion')).toBeVisible();
    const campoNumero = panelOp.getByTestId('numero-produccion-op');
    await expect(campoNumero).toHaveValue(new RegExp(`^${par}\\d{3}$`, 'u'));
    const numeroProduccion = await campoNumero.inputValue();
    // Matriz: aquí se CONSTRUYE — se agrega la talla (columna) y el color (fila) de ESTA corrida.
    const matriz = panelOp.getByTestId('matriz-op');
    await matriz.getByTestId('matriz-op-agregar-talla').selectOption({ label: talla });
    // V1-E4 (punto 7): el color se busca TECLEANDO (combobox server-side). El `<select>` topado a
    // 100 dejaba colores INALCANZABLES — el catálogo los rebasa (el importador de OC crea colores
    // solo). Es el mismo control que la matriz de la OP usa desde §Post-F9.11.
    await matriz.getByTestId('matriz-color-al-vuelo-input').fill(color);
    await page.getByTestId('matriz-color-al-vuelo-opcion').first().click();
    await matriz.getByTestId('matriz-op-celda').first().fill('60');
    await expect(panelOp.getByTestId('generar-op-capturado')).toContainText('cuadra');
    await page.getByTestId('confirmar-generar-op').click();

    // ⭐⭐ Toast del flujo COMPLETO. Es UNA sola frase, la que arma `PanelGenerarOP.tsx`, y aquí
    // salen sus cuatro trozos porque el modelo era de desarrollo Y el renglón trae ficha:
    // «OP <folio> creada · nace el modelo de producción <nº> del desarrollo <código>, que se
    // conserva · ligado a su desarrollo · Ruta Crítica programándose sola». Se exige ENTERA, con
    // el número y el código concretos de ESTA corrida: si el modelo de producción no naciera, el
    // toast diría sólo "OP N creada · Ruta Crítica programándose sola" y esta línea se pondría roja.
    //
    // ⚠️ V1-E3 (§Post-F9.172(b)): antes decía «(antes <código>, que se conserva)» porque la salida
    // TRANSFORMABA el modelo de desarrollo. Ya no: nace uno NUEVO por color y el desarrollo se
    // queda como está — por eso la frase cambió de "antes" a "del desarrollo".
    await expect(
      page.getByText(
        new RegExp(
          `OP \\d+ creada · nace el modelo de producción ${numeroProduccion} ` +
            `del desarrollo ${codigoDesarrollo}, que se conserva · ligado a su desarrollo · ` +
            `Ruta Crítica programándose sola`,
          'u',
        ),
      ),
    ).toBeVisible();

    // Y el modelo nuevo no se quedó en el toast: el renglón del pedido —que SIGUE enseñando su
    // código de DESARROLLO, porque el desarrollo ya no se transforma— ya trae la marca
    // `prod. #<nº>` del modelo de producción que nació de él (V1-E3).
    await expect(
      grupo.getByTestId('pedidos-renglon').filter({ hasText: codigoDesarrollo }),
    ).toContainText(`prod. #${numeroProduccion}`);

    // El renglón ya trae su No. orden (liga al centro de Órdenes).
    const ligaOrden = grupo.getByTestId('pedidos-liga-orden');
    await expect(ligaOrden).toBeVisible();
    const folioOrden = ((await ligaOrden.textContent()) ?? '').trim().split(' ')[0] ?? '';
    expect(folioOrden).not.toBe('');

    // ── El deep-link abre el centro de Órdenes con la OP y su snapshot de OC ────
    await ligaOrden.click();
    await expect(page.getByRole('heading', { name: 'Órdenes de producción' })).toBeVisible();
    const panelCentro = page.getByTestId('centro-panel');
    await expect(panelCentro.getByText(`OP ${folioOrden}`)).toBeVisible();
    // La cadena de trazabilidad del panel trae el SNAPSHOT de la OC del cliente (B3).
    await expect(panelCentro.getByTestId('traza-oc')).toContainText(ocCliente);
    await expect(panelCentro.getByTestId('traza-desarrollo')).toBeEnabled();

    // ── La RC se programó SOLA (outbox → consumidor, B5): poll por API + panel UNA vez ─
    // R4 cambió el mosaico "Ruta crítica": ya NO navega a /ruta-critica/ordenes/:id — abre el
    // PANEL deslizante "Ruta de la orden" aquí mismo. El consumidor corre en el backend del
    // compose (outbox + pg-boss) y puede tardar. Antes se reintentaba ABRIENDO y CERRANDO el
    // panel hasta 90 s, pero cada vuelta paga clic + animación + aserciones — en el CI del A1
    // (PR #154) ese churn ayudó a comerse el presupuesto del test (timeout de 180 s alcanzado
    // pasos después). Ahora la espera se ancla al ESTADO: se sondea la ruta por API con la
    // cookie de la sesión (patrón de `ruta-critica-motor.spec`) — cada intento cuesta
    // milisegundos y termina EN CUANTO el consumidor acaba — y el panel se abre UNA sola vez,
    // ya con la ruta lista, para verificar la UI.
    // El modelo se busca por su código VIGENTE: tras la promoción ya no es el de desarrollo,
    // sino el nº de producción (el buscador lee `modelos.codigo`, que la promoción reescribió).
    const idOrden = await idOrdenPorFolio(page.request, folioOrden, numeroProduccion);
    await expect
      .poll(
        async () => {
          const respuesta = await page.request.get(
            `/api/ruta-critica/ordenes/${String(idOrden)}/ruta`,
          );
          if (!respuesta.ok()) {
            return `http-${String(respuesta.status())}`;
          }
          const ruta = (await respuesta.json()) as {
            estadoRecalculo: 'calculado' | 'recalculando' | 'sin-ruta';
            procesos: unknown[];
          };
          // Lo mismo que exigía el panel: que la ruta exista Y liste procesos.
          return ruta.estadoRecalculo !== 'sin-ruta' && ruta.procesos.length > 0
            ? 'con-procesos'
            : ruta.estadoRecalculo;
        },
        { timeout: 90_000, intervals: [1_000] },
      )
      .toBe('con-procesos');

    await panelCentro.getByTestId('mosaico-rc').click();
    await expect(
      page.getByRole('heading', { name: `Ruta de la orden ${folioOrden}` }),
    ).toBeVisible();
    await expect(page.getByTestId('panel-ruta-procesos')).toBeVisible();
    // Cierra el panel (modal) para que el siguiente paso pueda interactuar con la página.
    await page.keyboard.press('Escape');

    // ── La edición fina F2 sigue viva en /pedidos/administrar (pedido real) ─────
    await page.goto('/pedidos/administrar');
    // ⚠️ Esta recarga completa es FLAKY CRÓNICO desde antes de esta rama: falla en las 3 corridas de
    // `prueba` del 18-ago y se salva con el reintento. Se afirma primero la URL para que, cuando
    // falle, el mensaje DIGA dónde acabó la página en vez del inútil "element(s) not found" — si
    // aterrizó en /login, la causa es la sesión (ver HOJA-DE-RUTA.md §4: `retry: false` trata un
    // parpadeo de red como "no hay sesión"), no el encabezado.
    await expect(page).toHaveURL(/\/pedidos\/administrar$/, { timeout: 30_000 });
    // `exact`: el matcher por nombre es substring y el panel de detalle trae un <h3>"Pedidos
    // reales"</h3> que aparece al auto-seleccionar un pedido (async) → sin exact, doble match flaky.
    await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId('buscar-pedido').fill(cliente);
    await page.getByTestId('fila-pedido').filter({ hasText: cliente }).first().click();
    const detallePedido = page.getByTestId('detalle-pedido');
    // ⭐⭐ V1-E3 (§Post-F9.172(b)) — el renglón enseña el código de DESARROLLO, y es correcto.
    //
    // 🔴 Aquí decía *"el código vigente del modelo, el de producción"* y esperaba el nº de 5
    // dígitos. Eso era verdad mientras generar la OP **transformaba** el modelo de desarrollo; desde
    // V1-E3 el desarrollo **se queda como está** —por eso de él pueden nacer cuatro modelos, uno por
    // color— y el renglón del pedido sigue apuntando a él. `PedidosPagina.tsx` pinta
    // `l.codigoModelo`, que es el del renglón.
    //
    // ⚠️ Es la GEMELA de la aserción de la vista por MES (arriba), que además enseña `prod. #<nº>`.
    // Y la diferencia NO es que a esta forma le falte el campo: `esquemaPedidoLineaSalida` **sí
    // tiene `numeroProduccion`** (comprobado compilando contra `PedidoLinea`). Lo que pasa es que
    // ese campo es el número del modelo **DEL RENGLÓN**, y tras V1-E3 el renglón apunta al
    // DESARROLLO —que ya no se promueve nunca— ⇒ **vale `null` para siempre**. Enseñarlo no
    // devolvería el número: enseñaría un hueco.
    //
    // Los números que Daniel quiere ver son los de los modelos HIJOS, uno por color, y ésos piden
    // la misma agregación en servidor que la vista del mes (`numerosProduccion`): contrato +
    // dominio + frontend ⇒ **etapa aparte (0.089)**, no un parche a esta prueba. Mientras tanto lo
    // que el detalle enseña —el nº de desarrollo— es dato cierto y buscable (D3).
    await expect(
      detallePedido.getByTestId('renglon-pedido').filter({ hasText: codigoDesarrollo }),
    ).toBeVisible();
    await detallePedido.getByTestId('nuevo-pedido-real').click();
    const dialogoReal = page.getByRole('dialog');
    await expect(dialogoReal.getByRole('heading', { name: 'Nuevo pedido real' })).toBeVisible();
    await dialogoReal.getByLabel('CEDIS').fill('CEDIS Norte');
    await page.getByTestId('confirmar-pedido-real').click();
    await expect(page.getByText('Pedido real creado.')).toBeVisible();
    await expect(
      detallePedido.getByTestId('pedido-real').filter({ hasText: 'CEDIS Norte' }),
    ).toBeVisible();
  });
});

/**
 * Resuelve el id interno de una orden por su folio vía el buscador global (`GET
 * /api/ordenes/buscar`), reusando la cookie de sesión del admin. El folio se repite entre
 * empresas y `q` busca por substring, así que el hit se acota al folio EXACTO y al modelo
 * único de la corrida.
 */
async function idOrdenPorFolio(
  request: APIRequestContext,
  folio: string,
  codigoModelo: string,
): Promise<number> {
  const respuesta = await request.get(`/api/ordenes/buscar?q=${folio}`);
  if (!respuesta.ok()) {
    throw new Error(`El buscador de órdenes respondió ${String(respuesta.status())}.`);
  }
  const { datos } = (await respuesta.json()) as {
    datos: { id: number; folio: number; codigoModelo: string }[];
  };
  const hit = datos.find((d) => d.folio === Number(folio) && d.codigoModelo === codigoModelo);
  if (hit === undefined) {
    throw new Error(`El buscador no encontró la OP ${folio} del modelo ${codigoModelo}.`);
  }
  return hit.id;
}

/** Fecha date-only `YYYY-MM-DD` a `dias` de HOY (hora local), para la fecha de entrega. */
function fechaRelativa(dias: number): string {
  const f = new Date();
  f.setDate(f.getDate() + dias);
  const a = f.getFullYear();
  const m = String(f.getMonth() + 1).padStart(2, '0');
  const d = String(f.getDate()).padStart(2, '0');
  return `${a}-${m}-${d}`;
}
