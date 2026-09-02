import { expect, test, type Locator, type Page } from '@playwright/test';

import { crearColorYTalla, elegirCliente, entrarComoAdmin } from './ayudas';

/**
 * E2E del módulo ÓRDENES (rediseño R2/R3) contra el stack real:
 *
 *  1. La OP ya NO se crea suelta (R3, §4.1): nace del PEDIDO con "Generar OP" (la matriz nace ahí).
 *     La CAPTURA/edición completa (F2-E3) se abre en el DIÁLOGO del mosaico "Modificar" del centro
 *     de comando para EDITAR: re-guardar la matriz, copiarla de otra orden, la referencia D7 y cancelar.
 *  2. El CENTRO DE COMANDO (`/produccion/ordenes`, §4.2) + AVANCE de producción (§4.3): la tabla
 *     de 13 columnas con filtros de servidor, el panel persistente con la matriz siempre visible,
 *     doble clic → avance, y el registro REAL de un corte. También la paleta ⌘K por folio (B4).
 *
 * Lecciones F5-E4 aplicadas: color+talla se siembran PRIMERO (`crearColorYTalla`); las lecturas
 * de "el primero" usan filtros por texto único de la corrida (nada depende del orden de la suite).
 */

/**
 * ⭐ V1-E8j (§Post-F9.134) — ALTA DEL MODELO EN `/modelos`, **con sus dos dígitos**.
 *
 * Desde esa decisión el alta del catálogo ya NO fabrica modelos de producción: **todo modelo nace en
 * DESARROLLO** y entra a producción por «pasar a producción» —o, como aquí, al **generar su OP**
 * (`salidaAProduccion` paso 4)—. Y para numerarlo el sistema necesita sus DOS dígitos: el del
 * concepto (tipo de prenda) y el del género (§Post-F9.83).
 *
 * Por eso este ayudante los captura. **Sin ellos la OP no sale**: `digitosDelModelo` no tiene de
 * dónde sacarlos, la propuesta del panel «Generar OP» falla y `confirmar()` rebota con un
 * `toast.error` (*"Confirma el número de producción del modelo (5 dígitos)"*). ⚠️ El botón **NO** se
 * deshabilita por eso —sólo lo apagan `generar.isPending` y `total === 0`, `PanelGenerarOP.tsx`—:
 * queda encendido y el rechazo llega al pulsarlo. Antes de V1-E8j nada de esto pasaba (el modelo
 * nacía ya en producción y no había nada que promover), y por eso estos specs no los capturaban.
 */
async function crearModeloUI(page: Page, codigo: string): Promise<void> {
  await page.goto('/modelos');
  await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
  await page.getByTestId('nuevo-modelo').click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Código').fill(codigo);
  // Los dos dígitos: Pantalón = 7 y Caballero = 1 (los siembra el seed) → serie `71`.
  await dialogo.getByLabel('Tipo de producto').selectOption({ label: 'Pantalón' });
  await dialogo.getByLabel('Género').selectOption({ label: 'Caballero' });
  await page.getByTestId('guardar-modelo').click();
  await expect(page.getByText(`Modelo "${codigo}" creado.`)).toBeVisible();
}

/** Crea un pedido interno con `renglones` renglones del MISMO modelo vía la edición F2. */
async function crearPedidoF2(
  page: Page,
  nombres: { cliente: string; codigoModelo: string },
  renglones = 1,
): Promise<void> {
  await page.goto('/pedidos/administrar');
  // `exact`: al reintentar, el detalle auto-selecciona un pedido y muestra un <h3>"Pedidos
  // reales"</h3> → sin exact el matcher substring caza 2 headings (flaky).
  await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toBeVisible();
  await page.getByTestId('nuevo-pedido').click();
  const dialogoPedido = page.getByRole('dialog');
  await elegirCliente(page, dialogoPedido, nombres.cliente, 'pedido-cliente');
  for (let i = 0; i < renglones; i++) {
    await dialogoPedido.getByTestId('agregar-renglon').click();
    const filaRenglon = dialogoPedido.getByTestId('fila-renglon').nth(i);
    await filaRenglon
      .getByLabel('Modelo del renglón')
      .selectOption({ label: nombres.codigoModelo });
    await filaRenglon.getByLabel('Cantidad del renglón').fill('50');
  }
  await page.getByTestId('guardar-pedido').click();
  await expect(page.getByText(/Pedido \d+ creado\./)).toBeVisible();
}

/**
 * GENERA la OP de un renglón sin orden del pedido del cliente dado (pantalla nueva de Pedidos,
 * R3): matriz de `piezas` en el color/talla de la corrida.
 *
 * Devuelve el folio de la OP **y el código del MODELO QUE QUEDÓ EN LA ORDEN**, que casi nunca es el
 * que se tecleó al dar de alta: desde V1-E8j el modelo nace en desarrollo, y desde V1-E3
 * (§Post-F9.172(b)) la salida a producción **hace nacer un modelo de producción POR COLOR** con su
 * nº de 5 dígitos y deja el desarrollo intacto. Quien llame tiene que usar el código que devuelve
 * este ayudante para buscar la orden en pantalla — el de desarrollo sigue vivo y buscable (D3),
 * pero **no es el de la OP**.
 */
async function generarOp(
  page: Page,
  nombres: { cliente: string; color: string; talla: string; codigoModelo: string },
  piezas: string,
): Promise<{ folio: string; codigoModelo: string }> {
  await page.goto('/pedidos');
  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
  const grupo = page.getByTestId('pedidos-grupo').filter({ hasText: nombres.cliente }).first();
  await expect(grupo).toBeVisible();
  await grupo.getByTestId('pedidos-generar-op').first().click();

  const panelOp = page.getByTestId('panel-generar-op');
  await expect(panelOp.getByRole('heading', { name: /Generar OP/ })).toBeVisible();
  const matriz = panelOp.getByTestId('matriz-op');
  await matriz.getByTestId('matriz-op-agregar-talla').selectOption({ label: nombres.talla });
  // V1-E4 (punto 7): el color se busca TECLEANDO (combobox server-side), no en un `<select>`
  // topado a la primera página del catálogo.
  await matriz.getByTestId('matriz-color-al-vuelo-input').fill(nombres.color);
  await page.getByTestId('matriz-color-al-vuelo-opcion').first().click();
  await matriz.getByTestId('matriz-op-celda').first().fill(piezas);

  // 🔴 ESPERAR LA PROPUESTA DEL NÚMERO ANTES DE CONFIRMAR (V1-E8j). El botón «Generar OP» se apaga
  // SÓLO por `generar.isPending || total === 0` (`PanelGenerarOP.tsx`), no por el número: en cuanto
  // hay una celda llena ya se puede pulsar. Pero el campo lo llena un `useEffect` cuando aterriza
  // `usePropuestaProduccion`, y si se pulsa antes, `confirmar()` rebota con un `toast.error` y el
  // spec muere. No sería un verde falso —falla ruidosa—, pero sí un flake, y justo en la parte del
  // flujo nuevo que nadie ha visto correr. Se espera al valor, que es la señal de que la propuesta
  // llegó. La sección sólo existe mientras el modelo es de DESARROLLO: en la SEGUNDA OP del mismo
  // modelo ya no está (la primera lo promovió), y por eso la espera es condicional.
  const seccionNumero = panelOp.getByTestId('confirmar-numero-produccion');
  if ((await seccionNumero.count()) > 0) {
    await expect(panelOp.getByTestId('numero-produccion-op')).toHaveValue(/^\d{5}$/);
  }

  await page.getByTestId('confirmar-generar-op').click();

  // El toast del éxito lo arma `PanelGenerarOP.tsx` (~L187) en UNA sola frase, con tres trozos
  // CONDICIONALES en medio. Aquí:
  //  • «· ligado a su desarrollo» NO sale: el pedido se capturó por la edición F2, sin desarrollo.
  //  • ⭐⭐ V1-E3 (§Post-F9.172(b)) — el trozo del MODELO sale SIEMPRE, y dice cuál de las tres
  //    cosas pasó: «· nace el modelo de producción N del desarrollo X, que se conserva» la PRIMERA
  //    vez de ese color, «· con el modelo N, que ese color ya tenía» en las siguientes (el número
  //    es del modelo, no de la orden) y «· modelo N» cuando el renglón ya apuntaba a un modelo de
  //    producción (histórico del Access). Antes había un caso sin trozo —la 2ª OP, cuando la 1ª
  //    había PROMOVIDO el modelo—; ya no lo hay, porque el desarrollo nunca se transforma.
  const toast = page
    .getByText(
      /OP \d+ creada · (?:nace el modelo de producción \d+[^·]*|con el modelo \d+[^·]*|modelo [^·]+) · Ruta Crítica programándose sola/,
    )
    .first();
  await expect(toast).toBeVisible();
  const texto = (await toast.textContent()) ?? '';
  const folio = /OP (\d+) creada/.exec(texto)?.[1] ?? '';
  expect(folio).not.toBe('');
  // El código del modelo QUE QUEDÓ EN LA ORDEN, salga por la frase que salga.
  const enLaOrden = /· (?:nace el |con el )?modelo(?: de producción)? ([^\s,·]+)/.exec(texto)?.[1];
  const codigoModelo = enLaOrden ?? nombres.codigoModelo;
  // El toast largo tapa botones; se espera a que SE VAYA antes de seguir interactuando (sonner lo
  // retira solo a los ~4 s y lo desmonta 200 ms después, así que `toBeHidden` termina en cuanto
  // desaparece del DOM). De paso deja el ayudante REENTRANTE: la siguiente llamada no puede leerle
  // el folio al toast de la anterior.
  //
  // ⚠️ (V1-E3 lo volvió a barrer: el toast cambió de «(antes X, que se conserva)» a «del desarrollo
  // X, que se conserva», y la 2ª OP pasó de NO tener trozo de modelo a decir «con el modelo N».)
  // ⚠️ Aquí vivía una línea que esperaba a que APARECIERA `/salió a producción como modelo #\d+/`
  // —lo contrario de lo que promete el comentario de arriba—. Y ojo con la historia, porque la
  // lección está ahí: ese texto SÍ existía; era el toast de antes. `cd4cd88` (V1-E3n) lo reescribió
  // en `PanelGenerarOP.tsx` para volverlo condicional y NO tocó `frontend/e2e/`. No fue una
  // aserción inventada: fue una aserción que se quedó vieja. **Quien cambie un texto de la UI barre
  // `frontend/e2e/` en el mismo cambio** — es la segunda vez que este repo lo aprende (la primera,
  // cuando la receta se mudó de sitio en V1-E3j).
  await expect(toast).toBeHidden({ timeout: 30_000 });
  return { folio, codigoModelo };
}

/**
 * Busca una orden por folio en el CENTRO DE ÓRDENES y la deja seleccionada. Devuelve el panel de
 * detalle persistente (`centro-panel`), que es donde viven los mosaicos y —desde V1-E3h— la RECETA
 * de la orden. NO abre el diálogo de «Modificar»: para eso está `abrirOrdenEnCaptura`.
 */
async function seleccionarOrdenEnCentro(
  page: Page,
  folio: string,
  codigoModelo: string,
): Promise<Locator> {
  await page.goto('/produccion/ordenes');
  await expect(page.getByRole('heading', { name: 'Órdenes de producción' })).toBeVisible();
  // La búsqueda del centro filtra en SERVIDOR con debounce: si se clickea al instante, la lista
  // aún trae TODAS las órdenes y `hasText: folio` (substring de un número corto) caza una celda de
  // OTRA fila (cantidades/fechas) — el run cazó "OP 5" por "OP 4". Y el texto EXACTO tampoco basta:
  // cualquier celda cuyo texto completo sea el folio también matchea — en el CI del A1 (PR #154)
  // el folio era "5" y la fila de la OTRA OP del mismo modelo (la de 5 pzas) matcheó por su celda
  // de cantidad. Se ancla al MODELO de la corrida (texto único) y a la CELDA DEL FOLIO
  // (`centro-folio`), que no puede confundirse con cantidades ni fechas.
  await page.getByTestId('centro-busqueda').fill(folio);
  const fila = page
    .getByTestId('centro-fila')
    .filter({ hasText: codigoModelo })
    .filter({
      has: page.getByTestId('centro-folio').filter({ hasText: new RegExp(`^${folio}$`) }),
    });
  await fila.first().click();
  // El panel persistente (escritorio) hospeda los mosaicos; se espera a que cargue la orden.
  //
  // ⚠️ SIEMPRE acotado a `centro-panel`: el panel de detalle se renderiza DOS veces —el `aside` de
  // escritorio y el cajón de móvil, ambos en el DOM—, así que un `page.getByTestId(...)` suelto
  // sobre cualquier cosa de su interior cazaría dos elementos y reventaría por modo estricto.
  const panel = page.getByTestId('centro-panel');
  await expect(panel.getByText(`OP ${folio}`)).toBeVisible();
  return panel;
}

/**
 * Selecciona la orden en el Centro **y abre «Modificar»** (el diálogo `detalle-orden`, F2-E3).
 *
 * ⚠️ Lo que vive en el DIÁLOGO y lo que vive en el PANEL son cosas distintas desde V1-E3h: la
 * RECETA se mira/ libera en el panel (ver `seleccionarOrdenEnCentro`), y aquí solo queda la edición
 * de la OP (encabezado, matriz, referencias).
 */
async function abrirOrdenEnCaptura(page: Page, folio: string, codigoModelo: string): Promise<void> {
  const panel = await seleccionarOrdenEnCentro(page, folio, codigoModelo);
  await panel.getByTestId('mosaico-modificar').click();
  await expect(page.getByTestId('detalle-orden')).toBeVisible();
}

/**
 * Crea cliente + modelo + pedido (F2) y una OP de 20 pzas vía "Generar OP".
 *
 * Devuelve el folio **y el código del MODELO QUE QUEDÓ EN LA ORDEN** — que no es el que se tecleó:
 * V1-E3 (§Post-F9.172(b)) hace NACER un modelo de producción por color, con su nº de 5 dígitos. El
 * modelo del renglón **no se transforma**: se queda en desarrollo, con su código.
 */
async function crearOrdenConMatriz(
  page: Page,
  nombres: { cliente: string; codigoModelo: string; color: string; talla: string },
): Promise<{ folio: string; codigoModelo: string }> {
  // Cliente.
  await page.goto('/catalogos/clientes');
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
  await page.getByTestId('nuevo-cliente').click();
  await page.getByRole('dialog').getByLabel('Nombre').fill(nombres.cliente);
  await page.getByTestId('guardar-cliente').click();
  await expect(page.getByText(`Cliente "${nombres.cliente}" creado.`)).toBeVisible();

  // Modelo (nace en DESARROLLO, con sus dos dígitos — V1-E8j).
  await crearModeloUI(page, nombres.codigoModelo);

  // Pedido (edición F2) + salida a producción con la matriz de 20 (R3).
  await crearPedidoF2(page, nombres);
  return generarOp(page, nombres, '20');
}

test.describe('Órdenes — captura completa (F2-E3, diálogo "Modificar")', () => {
  test('Generar OP (con su "Falta: receta") → re-guardar matriz → copiar matriz → referencia D7 → cancelar', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `Cliente Ordenes ${sufijo}`;
    const codigoModelo = `ORD-${sufijo}`;
    const campoReferencia = `No. de pedido ${sufijo}`;
    const valorReferencia = `OC-${sufijo}`;

    await entrarComoAdmin(page);
    const { color, talla } = await crearColorYTalla(page, sufijo);

    // ── Cliente CON un campo de referencia activo (D7) ──────────────────────────
    await page.goto('/catalogos/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();

    await page.getByTestId('buscar-cliente').fill(cliente);
    const detalleCliente = page.getByTestId('detalle-cliente');
    await page.getByTestId('fila-cliente').filter({ hasText: cliente }).first().click();
    await detalleCliente.getByTestId('nuevo-campo').click();
    const dialogoCampo = page.getByRole('dialog');
    await expect(
      dialogoCampo.getByRole('heading', { name: 'Nuevo campo de referencia' }),
    ).toBeVisible();
    await dialogoCampo.getByLabel('Etiqueta').fill(campoReferencia);
    await dialogoCampo.getByLabel('Tipo de dato').selectOption('TEXTO');
    await dialogoCampo.getByLabel('Orden').fill('1');
    await page.getByTestId('guardar-campo').click();
    await expect(page.getByText(`Campo "${campoReferencia}" agregado.`)).toBeVisible();

    // ── Modelo (nace en DESARROLLO, con sus dos dígitos — V1-E8j) ───────────────
    await crearModeloUI(page, codigoModelo);

    // ── Pedido con DOS renglones (dos OPs: una para copiarle la matriz a la otra) ─
    //    ⭐ V1-E3 (§Post-F9.172(b)) — el pedido se captura con el código de DESARROLLO (el que se
    //    tecleó), y **ahí se queda**: la OP no transforma ese modelo, hace NACER otro para su color.
    //    Por eso lo que busca la ORDEN en pantalla usa `codigoVigente` (el del modelo nuevo, que es
    //    el que la orden lleva) mientras el PEDIDO sigue enseñando el de desarrollo — los dos son
    //    ciertos, y son cosas distintas.
    await crearPedidoF2(page, { cliente, codigoModelo }, 2);
    const { folio: folio1, codigoModelo: codigoVigente } = await generarOp(
      page,
      { cliente, color, talla, codigoModelo },
      '20',
    );
    expect(codigoVigente).not.toBe(codigoModelo);
    const { folio: folio2 } = await generarOp(
      page,
      { cliente, color, talla, codigoModelo: codigoVigente },
      '5',
    );

    // ── ⭐ V1-E3h + V1-E3j: LA RECETA SE MIRA DESDE EL PANEL DE LA OP, Y SE TRABAJA EN SU PANTALLA ─
    //    V1-E3h (§Post-F9.72) la sacó del diálogo de «Modificar», donde vivía con el botón de
    //    LIBERAR —*la puerta que abre la compra*—. Daniel: *"ahí está y no tendría que estar ahí…
    //    nadie va a tener permiso de modificar la OP más que yo"*. Por eso estas afirmaciones van
    //    ANTES de abrir «Modificar» y cuelgan de `centro-panel`: si algún día la receta volviera a
    //    pedir el diálogo, la etapa se habría deshecho y esta prueba tiene que ser la que lo grite.
    //    V1-E3j movió el TRABAJO a una pantalla propia y dejó aquí un RESUMEN con su camino
    //    (*"ahí mismo en el cuadrito chiquito no se ve toda la información"*): el vistazo se
    //    conserva, el botón lleva a `/produccion/ordenes/:id/receta`, y **sigue sin pasar por
    //    «Modificar»** — que es la invariante que esta prueba cuida.
    const panelOp = await seleccionarOrdenEnCentro(page, folio1, codigoVigente);
    // La receta se acaba de copiar del modelo y Desarrollo todavía no la firma.
    await expect(panelOp.getByTestId('receta-sin-liberar')).toBeVisible();
    await panelOp.getByTestId('receta-abrir-pantalla').click();

    // ── La pantalla propia de la receta: encabezado de la OP + la receta completa ────────────
    await expect(page.getByRole('heading', { name: `Receta de la OP ${folio1}` })).toBeVisible();
    await expect(page.getByTestId('receta-encabezado-orden')).toContainText(codigoVigente);
    await expect(page.getByTestId('receta-encabezado-orden')).toContainText(cliente);
    // El modelo de esta prueba no tiene BOM, así que la receta nace VACÍA: se dice en tono neutro y
    // sin ofrecer nada que firmar (V1-E3j). Lo que se exige aquí es ESO —el mensaje neutro y que no
    // haya botón de firmar cuando no hay renglones—, y nada más.
    //
    // ⚠️ **AQUÍ NO SE VIGILA EL RETIRO DE LOS BOTONES DE BLOQUE de V1-E3k (§Post-F9.80).** Hubo un
    // intento y era una guardia FALSA: esta OP tiene `resumen.total === 0`, y con receta vacía los
    // cuatro botones YA estaban ocultos ANTES de la etapa (el global por `{vacia ? null : …}`, los
    // tres de sección por `pendientes === 0`). Reintroducirlos enteros dejaría este spec en VERDE,
    // así que afirmar la cobertura habría sido justo el modo de falla que esta etapa se puso como
    // estándar: una aserción sin ningún valor que pueda ponerla roja.
    //
    // Quien SÍ hace ese trabajo —sobre una receta CON renglones, que es donde los botones vivían—
    // es `PanelRecetaOrden.test.tsx` › «NO existe ningún botón de firmar en bloque…» y su gemela
    // por TEXTO. Ahí la mutación de reintroducirlos las pone rojas; aquí no las pondría.
    await expect(page.getByTestId('receta-orden')).toBeVisible();
    await expect(page.getByText(/todavía no tiene ningún material/i)).toBeVisible();
    await expect(page.locator('[data-testid^="liberar-receta-"]')).toHaveCount(0);

    // ── En el DIÁLOGO de «Modificar» queda la edición de la OP (estado, matriz, referencias) ────
    //    La OP nace con matriz (R3) pero NO completa. Desde V1-E3d (§Post-F9.43) el estado
    //    AUTOMÁTICO es **tallas + receta LIBERADA, y arte si aplica**: la receta se acaba de copiar
    //    del modelo y Desarrollo todavía no la libera, y el modelo de la prueba tampoco tiene arte
    //    ("lleva arte" viene MARCADO por default, decisión de Daniel). La pantalla tiene que DECIR
    //    qué falta. Ojo: incompleta NO impide operar la orden (cortar y producir siguen abiertos).
    await abrirOrdenEnCaptura(page, folio1, codigoVigente);
    const detalle = page.getByTestId('detalle-orden');
    await expect(detalle.getByTestId('estado-orden').first()).toHaveText('Capturada');
    await expect(detalle.getByTestId('faltantes-orden').first()).toHaveText(
      'Falta: liberar la receta y arte',
    );
    const matriz = detalle.getByTestId('matriz-orden');
    await matriz.getByTestId('matriz-orden-celda').first().fill('25');
    // Guardado ÚNICO (Daniel 24-jul-2026): un solo botón en el pie del diálogo, para TODO.
    await expect(page.getByTestId('guardar-orden')).toBeEnabled();
    await page.getByTestId('guardar-orden').click();
    await expect(page.getByText('Cambios guardados.')).toBeVisible();

    // ── Copiar la matriz de la OP 1 sobre la OP 2 ───────────────────────────────
    await abrirOrdenEnCaptura(page, folio2, codigoVigente);
    await detalle.getByTestId('abrir-copiar-matriz').click();
    // El panel de edición también es un `dialog`: se acota el de copiar por su nombre accesible.
    const dialogoCopiar = page.getByRole('dialog', { name: /Copiar matriz/ });
    await expect(dialogoCopiar.getByRole('heading', { name: /Copiar matriz/ })).toBeVisible();
    await dialogoCopiar.getByTestId('copiar-matriz-buscar').fill(folio1);
    await dialogoCopiar.getByTestId('copiar-matriz-opcion').first().click();
    await page.getByTestId('confirmar-copiar-matriz').click();
    await expect(page.getByText('Matriz copiada.')).toBeVisible();
    // El copiado invalida el detalle de la orden: cuando el refetch llega, las secciones se
    // RE-INICIALIZAN con lo del servidor (PanelMatriz/PanelReferencias) y PISAN lo capturado
    // después de este punto. Antes de teclear la referencia se espera a que el refetch YA esté
    // aplicado (la matriz enseña la cantidad copiada); si no, el reset borra lo tecleado, la
    // sección deja de estar "sucia" y `guardar-orden` queda deshabilitado para siempre (race
    // real del CI del A1, PR #154: 278 reintentos de click sobre el botón deshabilitado).
    await expect(matriz.getByTestId('matriz-orden-celda').first()).toHaveValue('25');

    // ── Referencia D7 (misma vía: el botón único del pie) ───────────────────────
    const campoRef = detalle.getByLabel(campoReferencia);
    await expect(campoRef).toBeVisible();
    await campoRef.fill(valorReferencia);
    await expect(page.getByTestId('guardar-orden')).toBeEnabled();
    await page.getByTestId('guardar-orden').click();
    await expect(page.getByText('Cambios guardados.')).toBeVisible();
    await expect(campoRef).toHaveValue(valorReferencia);
    // Guardado todo, el botón vuelve a quedar deshabilitado (sin cambios pendientes).
    await expect(page.getByTestId('guardar-orden')).toBeDisabled();

    // ── Cancelar con motivo ─────────────────────────────────────────────────────
    await page.getByTestId('cancelar-orden').click();
    // El panel de edición también es un `dialog`: se acota el de cancelar por su nombre accesible.
    const dialogoCancelar = page.getByRole('dialog', { name: /Cancelar orden/ });
    await expect(dialogoCancelar.getByRole('heading', { name: /Cancelar orden/ })).toBeVisible();
    await expect(page.getByTestId('confirmar-cancelar-orden')).toBeDisabled();
    await page.getByTestId('orden-motivo-cancelar').fill('Cancelada en la prueba E2E');
    await page.getByTestId('confirmar-cancelar-orden').click();
    await expect(page.getByText(/Orden \d+ cancelada\./)).toBeVisible();
  });
});

test.describe('Órdenes — centro de comando + avance de producción (R2)', () => {
  test('la tabla de 13 columnas filtra en servidor, el panel muestra la matriz y el avance registra un corte', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const sufijo = (Date.now() + 1).toString().slice(-6);
    const cliente = `Cliente Centro ${sufijo}`;
    const codigoModelo = `CEN-${sufijo}`;
    const cortador = `Cortador E2E ${sufijo}`;

    await entrarComoAdmin(page);
    const { color, talla } = await crearColorYTalla(page, sufijo);

    // ── Un proveedor con el rol CORTE (el avance exige el rol, D12/R15) ─────────
    await page.goto('/catalogos/proveedores');
    await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();
    await page.getByTestId('nuevo-proveedor').click();
    const dialogoProveedor = page.getByRole('dialog');
    // Por id: el label "Nombre" ya no es único en el diálogo (se agregó "Nombre corto", A1.1).
    await dialogoProveedor.locator('#proveedor-nombre').fill(cortador);
    await dialogoProveedor
      .getByTestId('selector-roles-proveedor')
      .getByRole('checkbox', { name: 'Corte', exact: true })
      .check();
    await page.getByTestId('guardar-proveedor').click();
    await expect(page.getByText(`Proveedor "${cortador}" creado.`)).toBeVisible();

    // ── Orden con matriz (20 pzas) vía Generar OP (R3) ──────────────────────────
    // ⭐ V1-E8j — la OP promueve el modelo, así que el código que la tabla enseña es el NUEVO.
    const { folio, codigoModelo: codigoVigente } = await crearOrdenConMatriz(page, {
      cliente,
      codigoModelo,
      color,
      talla,
    });

    // ── Centro de comando: buscar por folio (filtro de servidor) ────────────────
    await page.goto('/produccion/ordenes');
    await expect(page.getByRole('heading', { name: 'Órdenes de producción' })).toBeVisible();
    // El filtro de mes (ahora un select más en la barra) y los demás filtros están presentes.
    await expect(page.getByTestId('centro-filtro-mes')).toBeVisible();
    await expect(page.getByTestId('centro-filtro-oc')).toBeVisible();

    await page.getByTestId('centro-busqueda').fill(folio);
    const fila = page.getByTestId('centro-fila').filter({ hasText: codigoVigente }).first();
    await expect(fila).toBeVisible();
    // Columnas clave de la fila: ordenada 20, sin cortar, OC de tela "falta".
    await expect(fila).toContainText('20');
    await expect(fila).toContainText('falta');
    await expect(fila).toContainText(cliente);

    // ── Panel persistente: matriz SIEMPRE visible + precios + mosaicos ─────────
    await fila.click();
    const panel = page.getByTestId('centro-panel');
    await expect(panel.getByText(`OP ${folio}`)).toBeVisible();
    await expect(panel.getByTestId('centro-matriz')).toBeVisible();
    await expect(panel.getByTestId('centro-matriz-total')).toHaveText('20');
    await expect(panel.getByTestId('centro-mosaicos')).toBeVisible();
    await expect(panel.getByTestId('panel-precios')).toBeVisible();

    // ── Mosaico Habilitación (R6): abre el panel de surtido de la orden ───────
    await expect(panel.getByTestId('mosaico-habilitacion')).toBeEnabled();
    await panel.getByTestId('mosaico-habilitacion').click();
    await expect(page.getByTestId('panel-habilitacion')).toBeVisible();
    await expect(page.getByTestId('hab-ver-notas')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('panel-habilitacion')).toBeHidden();

    // La cadena de trazabilidad (R3) enseña el pedido interno y la OP.
    await expect(panel.getByTestId('traza-op')).toContainText(folio);
    await expect(panel.getByTestId('traza-pedido')).toBeEnabled();

    // ── Doble clic → AVANCE DE PRODUCCIÓN (stepper de 6 etapas) ────────────────
    await fila.dblclick();
    const avance = page.getByTestId('avance-produccion');
    await expect(avance).toBeVisible();
    await expect(avance.getByText(`Avance de producción · OP ${folio}`)).toBeVisible();
    await expect(avance.getByTestId('avance-stepper-corte')).toContainText('0/20');
    await expect(avance.getByTestId('avance-stepper-recibo-aplicacion')).toBeVisible();
    // V1-E3a: la ENTREGA A CLIENTE es la 6ª etapa (cierra el ciclo). Antes el stepper terminaba en
    // "Recibo de Arte" y la entrega no la enlazaba NADA: el producto entraba a PT y no salía nunca.
    await expect(avance.getByTestId('avance-stepper-entrega-cliente')).toContainText('0/20');

    // ── Registrar un CORTE real: combobox con búsqueda (homónimos) + candado ────
    await avance.getByTestId('avance-abrir-captura').click();
    const captura = avance.getByTestId('avance-captura');
    await expect(
      captura.getByText(/Candado: solo los renglones y tallas de la orden/),
    ).toBeVisible();
    // El combobox filtra sin acentos/mayúsculas: "cortador e2e" encuentra al proveedor.
    await captura.getByTestId('avance-proveedor-input').fill(`cortador e2e ${sufijo}`);
    await page.getByTestId('avance-proveedor-opcion').first().click();
    // La matriz con candado SOLO trae la celda del color/talla de la orden.
    await expect(captura.getByTestId('avance-matriz-celda')).toHaveCount(1);
    await captura.getByTestId('avance-matriz-celda').fill('20');
    await expect(captura.getByTestId('avance-matriz-estado')).toContainText('Cuadra');
    await captura.getByTestId('avance-guardar').click();
    // Toast con la nota del auto-avance de la Ruta Crítica (F3→F5).
    await expect(page.getByText(/la Ruta Crítica se marca sola/)).toBeVisible();

    // El movimiento aparece en la lista con su "capturado por" (A7/§4.4.4)…
    const movimiento = avance.getByTestId('avance-movimiento').first();
    await expect(movimiento).toContainText(cortador);
    await expect(movimiento).toContainText('Administrador');
    await expect(movimiento).toContainText('20');
    // …y el stepper marca el corte COMPLETO (20/20).
    await expect(avance.getByTestId('avance-stepper-corte')).toContainText('20/20');
    await expect(avance.getByTestId('avance-stepper-corte')).toHaveAttribute('data-estado', 'done');
    // Resumen en dos bloques (costura + aplicación).
    await expect(avance.getByTestId('avance-resumen')).toContainText('Resumen · costura');

    // Cerrar el avance regresa al centro, con la cortada actualizada (servidor).
    await avance.getByTestId('avance-cerrar').click();
    await expect(page.getByTestId('avance-produccion')).toHaveCount(0);

    // ── La paleta ⌘K encuentra la ORDEN por folio (B4: absorbió el buscador) ────
    await page.getByTestId('abrir-paleta').click();
    await page.getByTestId('paleta-input').fill(folio);
    const hit = page.getByTestId('paleta-orden').first();
    await expect(hit).toContainText(`Orden ${folio}`);
    await hit.click();
    await expect(page).toHaveURL(/\/produccion\/ordenes$/);
    await expect(page.getByTestId('centro-panel').getByText(`OP ${folio}`)).toBeVisible();
  });
});
