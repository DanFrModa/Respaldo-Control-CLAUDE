import { expect, test, type APIRequestContext } from '@playwright/test';

import { crearColorYTalla, elegirCliente, entrarComoAdmin, RC_APAGADA } from './ayudas';

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
 * ⚠️ **Por qué el modelo NACE en Desarrollo y no en `/modelos` (V1-E3n).** El título de la prueba
 * promete "OP con nº de producción", y ese número sólo existe si el modelo se PROMUEVE al generar
 * la OP. Un modelo dado de alta en `/modelos` nace ya en producción (`crearModelo` pone
 * `origen: 'produccion'`), así que no hay nada que promover y el toast sale sin número. Y un
 * modelo de desarrollo no se puede numerar sin sus DOS dígitos —concepto (tipo de prenda) y
 * género (§Post-F9.83)—, que es justo lo que el alta del catálogo no pide. El único camino real
 * es el que usa el negocio: el desarrollo con "Crear un modelo nuevo", que exige tipo de prenda +
 * género y arma el código `ABR-26-71-001` con la abreviatura del cliente. Por eso el cliente se
 * captura CON abreviatura: sin ella el sistema se niega a armar el código (y hace bien).
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
    // Abreviatura del cliente = el "CYA" de `CYA-26-71-001`: 2–6 letras/dígitos y ÚNICA en el
    // catálogo (el backend la exige libre). Se saca del reloj en base 36 —no del `sufijo`— porque
    // los 6 dígitos decimales se repiten cada 1,000 s y aquí un choque no da un nombre feo sino un
    // 409: en base 36, 5 caracteres tardan ~17 h en repetirse.
    const abreviatura = `E${Date.now().toString(36).slice(-5).toUpperCase()}`;
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

    // ⭐ Toast del flujo COMPLETO. Es UNA sola frase, la que arma `PanelGenerarOP.tsx` (~L187), y
    // aquí salen sus tres trozos porque el modelo era de desarrollo Y el renglón trae ficha:
    // «OP <folio> creada · modelo de producción <nº> (antes <código de desarrollo>, que se
    // conserva) · ligado a su desarrollo». Se exige ENTERA, con el número y el código concretos de
    // ESTA corrida: si la promoción se cayera, el toast diría sólo "OP N creada" —que es
    // exactamente lo que pasaba cuando el modelo nacía en `/modelos`— y esta línea se pondría roja.
    //
    // ⭐ V1-E3t: el CUARTO trozo («· Ruta Crítica programándose sola») ya no sale, y no por
    // capricho del texto: con la RC apagada (§Post-F9.36 punto 1) nadie tiene `rc.ruta-ver` y NO
    // se está programando ninguna ruta. El `$` del final es lo que lo vigila.
    const coletillaRc = RC_APAGADA ? '' : ' · Ruta Crítica programándose sola';
    await expect(
      page.getByText(
        new RegExp(
          `^OP \\d+ creada · modelo de producción ${numeroProduccion} ` +
            `\\(antes ${codigoDesarrollo}, que se conserva\\) · ligado a su desarrollo` +
            `${coletillaRc}$`,
          'u',
        ),
      ),
    ).toBeVisible();

    // Y la promoción no se quedó en el toast: el renglón del pedido ya enseña el modelo con su
    // código NUEVO (el de producción) y su marca `prod. #<nº>`.
    await expect(
      grupo.getByTestId('pedidos-renglon').filter({ hasText: numeroProduccion }),
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

    // ── ⭐ V1-E3t · LA RC ESTÁ APAGADA: ni mosaico, ni ruta, ni API ────────────────────
    // Aquí vivía la comprobación de que "la RC se programa sola" (outbox → consumidor, B5). La
    // Ruta Crítica arranca APAGADA en la v1 (`DECISIONES.md §Post-F9.36 punto 1`), así que este
    // tramo pasó a comprobar lo contrario, y por las TRES capas que pide §Post-F9.68:
    //  1. el MOSAICO «Ruta crítica» del panel no se ofrece (lo esconde `rc.ruta-ver`);
    //  2. la RUTA de pantalla queda cerrada aunque se teclee la URL a pelo;
    //  3. el SERVIDOR responde 403 — la que de verdad manda: sin ella lo demás es maquillaje.
    // Cuando la RC se encienda, este bloque vuelve a ser el de antes (está en el historial de
    // `pedidos.spec.ts`, commit de V1-E3t).
    if (RC_APAGADA) {
      const idOrden = await idOrdenPorFolio(page.request, folioOrden, numeroProduccion);
      // 1) Esconder.
      await expect(panelCentro.getByTestId('mosaico-rc')).toHaveCount(0);
      // 3) Bloquear (el servidor, con la cookie de una sesión de ADMIN — el usuario con más
      //    permisos que existe). Un 200 aquí significaría que la RC sigue servida a quien sea.
      const respuestaRuta = await page.request.get(
        `/api/ruta-critica/ordenes/${String(idOrden)}/ruta`,
      );
      expect(respuestaRuta.status()).toBe(403);
      // 2) Cerrar la ruta de pantalla.
      await page.goto(`/ruta-critica/ordenes/${String(idOrden)}`);
      await expect(page.getByTestId('pantalla-no-disponible')).toBeVisible();
      await page.goBack();
    } else {
      // ⭐ La verificación ORIGINAL (nota N4 del reviewer): sin este `else`, el paso 2 del
      // procedimiento de re-encendido —poner `RC_APAGADA = false`— dejaba este tramo del spec
      // MUDO, y «la RC se programa sola» se quedaría sin prueba punta a punta justo el día que
      // vuelva a importar. Se conserva tal cual estaba (V1-E3t la movió, no la borró).
      //
      // El consumidor corre en el backend del compose (outbox + pg-boss) y puede tardar, así que
      // la espera se ancla al ESTADO sondeando la ruta por API con la cookie de la sesión —cada
      // intento cuesta milisegundos y termina EN CUANTO el consumidor acaba— y el panel se abre
      // UNA sola vez, ya con la ruta lista, para verificar la UI.
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
      await page.keyboard.press('Escape');
    }

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
    // Mismo motivo que arriba: el renglón enseña el código vigente del modelo, el de producción.
    await expect(
      detallePedido.getByTestId('renglon-pedido').filter({ hasText: numeroProduccion }),
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
