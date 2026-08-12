import { expect, test, type APIRequestContext } from '@playwright/test';

import { crearColorYTalla, entrarComoAdmin } from './ayudas';

/**
 * E2E del FLUJO NUEVO de Pedidos (rediseño R3, §4.1) contra el stack real:
 *
 *  1. Se siembran cliente + departamento + modelo + DESARROLLO (F8, vía UI) y color + talla
 *     (`crearColorYTalla`, lección F5-E4: la matriz los necesita ANTES).
 *  2. CONSTRUCTOR "Nuevo pedido interno": cliente (combobox) + fecha de entrega + OC del cliente +
 *     renglón con el SELECTOR de desarrollos (búsqueda server-side) → folio `-F` automático.
 *  3. La tabla AGRUPADA muestra el pedido con su chip de OC y el renglón con "Generar OP".
 *  4. "GENERAR OP": aquí NACE la matriz color×talla → al confirmar, la OP sale a producción con su
 *     nº interno de producción y el snapshot de la OC, y su Ruta Crítica se PROGRAMA SOLA (outbox,
 *     B5) — se verifica con un poll sobre la pantalla de la RC de la orden (el consumidor corre en
 *     el backend del compose; se le da margen).
 *  5. La edición fina F2 sigue viva en /pedidos/administrar (pedido real con réplica de renglones).
 */
test.describe('Pedidos (rediseño R3, §4.1)', () => {
  test('constructor → tabla agrupada → Generar OP con matriz → OP con nº de producción + OC snapshot + RC sola', async ({
    page,
  }) => {
    test.setTimeout(180_000); // flujo largo: siembra + constructor + OP + poll de la RC.
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `Cliente Flujo ${sufijo}`;
    const departamento = `NIÑOS ${sufijo}`;
    const codigoModelo = `FLU-${sufijo}`;
    const nombreProyecto = `Joggers ${sufijo}`;
    const ocCliente = `OC-E2E-${sufijo}`;

    await entrarComoAdmin(page);
    const { color, talla } = await crearColorYTalla(page, sufijo);

    // ── Cliente + departamento (el desarrollo cuelga de Cliente+Departamento) ───
    await page.goto('/catalogos/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();
    await page.getByTestId('buscar-cliente').fill(cliente);
    await page.getByTestId('fila-cliente').filter({ hasText: cliente }).first().click();
    await page.getByTestId('nuevo-departamento').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(departamento);
    await page.getByTestId('guardar-departamento').click();
    await expect(page.getByText(`Departamento "${departamento}" agregado.`)).toBeVisible();

    // ── Modelo + proyecto + desarrollo (F8) ─────────────────────────────────────
    await page.goto('/modelos');
    await expect(page.getByRole('heading', { name: 'Modelos' })).toBeVisible();
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(codigoModelo);
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoModelo}" creado.`)).toBeVisible();

    await page.goto('/desarrollo');
    // R9 fidelidad: la lista de proyectos es tabla-first con el título del proto `vPrecosteosLista`.
    await expect(page.getByRole('heading', { name: 'Pre-costeos', exact: true })).toBeVisible();
    await page.getByTestId('nuevo-proyecto').click();
    const dialogoProyecto = page.getByRole('dialog');
    await dialogoProyecto.getByLabel('Cliente').selectOption({ label: cliente });
    await dialogoProyecto.getByLabel('Departamento').selectOption({ label: departamento });
    await dialogoProyecto.getByLabel('Nombre / tema').fill(nombreProyecto);
    await page.getByTestId('guardar-proyecto').click();
    await expect(page.getByText(/Proyecto \d+ creado\./)).toBeVisible();
    await page.getByTestId('fila-proyecto').filter({ hasText: nombreProyecto }).first().click();
    const detalleProyecto = page.getByTestId('detalle-proyecto');
    await detalleProyecto.getByTestId('agregar-desarrollo').click();
    await page.getByRole('dialog').getByTestId('desarrollo-modelo-busqueda').fill(codigoModelo);
    await page
      .getByTestId('desarrollo-modelo-opcion')
      .filter({ hasText: codigoModelo })
      .first()
      .click();
    await page.getByTestId('guardar-desarrollo').click();
    await expect(page.getByText('Desarrollo agregado.')).toBeVisible();

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
    await constructor.getByTestId('constructor-desarrollo-input').fill(codigoModelo);
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
    const renglon = grupo.getByTestId('pedidos-renglon').filter({ hasText: codigoModelo });
    await expect(renglon).toBeVisible();

    // ── Generar OP: aquí NACE la matriz color×talla ─────────────────────────────
    await renglon.getByTestId('pedidos-generar-op').click();
    const panelOp = page.getByTestId('panel-generar-op');
    await expect(panelOp.getByRole('heading', { name: /Generar OP/ })).toBeVisible();
    // La cadena de trazabilidad enseña la OC y el pedido; la OP está "por generar".
    await expect(panelOp.getByTestId('traza-oc')).toContainText(ocCliente);
    await expect(panelOp.getByTestId('traza-op')).toContainText('por generar');
    // Matriz: aquí se CONSTRUYE — se agrega la talla (columna) y el color (fila) de ESTA corrida.
    const matriz = panelOp.getByTestId('matriz-op');
    await matriz.getByTestId('matriz-op-agregar-talla').selectOption({ label: talla });
    await matriz.getByTestId('matriz-op-agregar-color').selectOption({ label: color });
    await matriz.getByTestId('matriz-op-celda').first().fill('60');
    await expect(panelOp.getByTestId('generar-op-capturado')).toContainText('cuadra');
    await page.getByTestId('confirmar-generar-op').click();

    // Toast del flujo completo: OP + nº interno de producción + liga + RC sola.
    const toast = page.getByText(/salió a producción como modelo #\d+/);
    await expect(toast).toBeVisible();
    await expect(page.getByText(/Ruta Crítica programándose sola/)).toBeVisible();

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
    const idOrden = await idOrdenPorFolio(page.request, folioOrden, codigoModelo);
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
    // `exact`: el matcher por nombre es substring y el panel de detalle trae un <h3>"Pedidos
    // reales"</h3> que aparece al auto-seleccionar un pedido (async) → sin exact, doble match flaky.
    await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toBeVisible();
    await page.getByTestId('buscar-pedido').fill(cliente);
    await page.getByTestId('fila-pedido').filter({ hasText: cliente }).first().click();
    const detallePedido = page.getByTestId('detalle-pedido');
    await expect(
      detallePedido.getByTestId('renglon-pedido').filter({ hasText: codigoModelo }),
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
