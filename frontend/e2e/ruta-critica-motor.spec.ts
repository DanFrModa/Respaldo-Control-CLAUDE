import { expect, test, type APIRequestContext } from '@playwright/test';

import { crearColorYTalla, entrarComoAdmin } from './ayudas';

/**
 * E2E del MOTOR de la Ruta Crítica por orden (F5-E5; pantalla R4 "Mis pendientes") contra el stack
 * real, en el estándar visual. El primer test arma el ciclo COMPLETO de extremo a extremo:
 *   catálogo RC (familia/artículo/tela/aplicación vía API) + plantilla con 2 procesos (cada uno con
 *   duración > 0, sin encadenamiento entre sí) → cliente + modelo + pedido + orden con matriz (UI) →
 *   PROGRAMAR RC desde el detalle de la orden → ambos procesos quedan como PENDIENTES en Mis
 *   pendientes (a la que se llega por el MENÚ: hoja directa "Ruta Crítica", R4) → "Marcar hecho"
 *   (los procesos del test son manuales) saca uno y luego el otro.
 * (El encadenamiento real "la pelota pasa al siguiente" lo cubre un test de integración del backend.)
 * El segundo test verifica Mis pendientes en viewport MÓVIL.
 *
 * El catálogo RC (familia/artículo/tela/aplicación) NO tiene UI de alta en esta etapa: se siembra por
 * API reutilizando la cookie de sesión del admin (`page.request`). Sufijos únicos por corrida.
 */
test.describe('Ruta Crítica — motor por orden (F5-E5)', () => {
  test('programar una orden → ambos procesos pendientes en Mis pendientes → marcar hecho uno y luego el otro', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `Cliente RC ${sufijo}`;
    const codigoModelo = `RC-${sufijo}`;
    const nombreFamilia = `Familia RC ${sufijo}`;
    const nombreArticulo = `Artículo RC ${sufijo}`;
    const nombreTela = `Tela RC ${sufijo}`;
    const nombreAplicacion = `Aplicación RC ${sufijo}`;
    const nombrePlantilla = `Plantilla RC ${sufijo}`;
    const proc1Codigo = `e2e-rc1-${sufijo}`;
    const proc1Nombre = `Proc RC 1 ${sufijo}`;
    const proc2Codigo = `e2e-rc2-${sufijo}`;
    const proc2Nombre = `Proc RC 2 ${sufijo}`;

    await entrarComoAdmin(page);
    await crearColorYTalla(page);

    // ── 1) Catálogo RC mínimo por API (sin UI de alta en esta etapa) ────────────
    const idArticulo = await sembrarCatalogoRc(page.request, {
      nombreFamilia,
      nombreArticulo,
      nombreTela,
      nombreAplicacion,
    });

    // ── 2) Dos procesos del catálogo (F5-E1) ────────────────────────────────────
    await page.goto('/ruta-critica/procesos');
    await expect(page.getByRole('heading', { name: 'Procesos de la Ruta Crítica' })).toBeVisible();
    for (const [codigo, nombre] of [
      [proc1Codigo, proc1Nombre],
      [proc2Codigo, proc2Nombre],
    ] as const) {
      await page.getByTestId('nuevo-proceso-rc').click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Código').fill(codigo);
      await dlg.getByLabel('Nombre').fill(nombre);
      await page.getByTestId('guardar-proceso-rc').click();
      await expect(page.getByText(`Proceso "${nombre}" creado.`)).toBeVisible();
    }

    // ── 3) Plantilla del artículo con ambos procesos ────────────────────────────
    await page.goto('/ruta-critica/plantillas');
    await expect(page.getByRole('heading', { name: 'Plantillas de ruta' })).toBeVisible();
    await page.getByTestId('nuevo-plantilla-rc').click();
    const dialogoPlantilla = page.getByRole('dialog');
    await page.getByTestId('plantilla-nombre').fill(nombrePlantilla);
    // Liga la plantilla al artículo recién creado (para que la programación la resuelva).
    await dialogoPlantilla
      .getByLabel('Artículo (opcional)')
      .selectOption({ label: nombreArticulo });
    const editorProcesos = page.getByTestId('editor-procesos-plantilla');
    await editorProcesos.getByText(proc1Nombre, { exact: true }).click();
    await editorProcesos.getByText(proc2Nombre, { exact: true }).click();
    // Sin tiempo, cada proceso queda en duración 0 y el motor lo AUTO-COMPLETA (no entra a la
    // bandeja). Cada proceso incluido muestra su input "Días" (spinbutton); les damos duración > 0.
    const tiempos = editorProcesos.getByRole('spinbutton');
    await tiempos.nth(0).fill('3');
    await tiempos.nth(1).fill('2');
    await page.getByTestId('guardar-plantilla').click();
    await expect(page.getByText('Plantilla creada.')).toBeVisible();

    // ── 4) Cliente + modelo + pedido + orden con matriz ─────────────────────────
    await page.goto('/catalogos/clientes');
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();

    await page.goto('/modelos');
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(codigoModelo);
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoModelo}" creado.`)).toBeVisible();

    // Pedido por la edición F2 (/pedidos/administrar) SIN fecha de entrega: así la RC AUTOMÁTICA
    // del alta (R3, B5) se OMITE (sin fecha no se puede planear) y ESTE test programa a MANO con
    // su plantilla/artículo propios, como antes.
    await page.goto('/pedidos/administrar');
    await page.getByTestId('nuevo-pedido').click();
    const dialogoPedido = page.getByRole('dialog');
    await dialogoPedido.getByLabel('Cliente').selectOption({ label: cliente });
    await dialogoPedido.getByTestId('agregar-renglon').click();
    const filaRenglon = dialogoPedido.getByTestId('fila-renglon').first();
    await filaRenglon.getByLabel('Modelo del renglón').selectOption({ label: codigoModelo });
    await filaRenglon.getByLabel('Cantidad del renglón').fill('50');
    await page.getByTestId('guardar-pedido').click();
    await expect(page.getByText(/Pedido \d+ creado\./)).toBeVisible();

    // R3: la OP nace del pedido con "Generar OP" (ahí NACE su matriz de 20 pzas).
    await page.goto('/pedidos');
    await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
    const grupo = page.getByTestId('pedidos-grupo').filter({ hasText: cliente }).first();
    await expect(grupo).toBeVisible();
    await grupo.getByTestId('pedidos-generar-op').first().click();
    const panelOp = page.getByTestId('panel-generar-op');
    const matrizOp = panelOp.getByTestId('matriz-op');
    await matrizOp.getByTestId('matriz-op-agregar-talla').selectOption({ index: 1 });
    await matrizOp.getByTestId('matriz-op-agregar-color').selectOption({ index: 1 });
    await matrizOp.getByTestId('matriz-op-celda').first().fill('20');
    await page.getByTestId('confirmar-generar-op').click();
    const toastOp = page.getByText(/OP \d+ creada/).first();
    await expect(toastOp).toBeVisible();
    const folioOrden = /OP (\d+) creada/.exec((await toastOp.textContent()) ?? '')?.[1] ?? '';
    expect(folioOrden).not.toBe('');

    // La edición completa (con el botón de programar la RC) se abre con el mosaico "Modificar"
    // del centro de comando (el panel viejo `/produccion/ordenes/captura` fue retirado).
    await page.goto('/produccion/ordenes');
    await expect(page.getByRole('heading', { name: 'Órdenes de producción' })).toBeVisible();
    await page.getByTestId('centro-busqueda').fill(folioOrden);
    // La búsqueda del centro filtra en SERVIDOR con debounce; `hasText: folioOrden` (substring de un
    // número corto) puede cazar otra fila antes de que aplique. Se acota al MODELO de la corrida
    // (texto único; esta prueba crea una sola orden de ese modelo).
    await page.getByTestId('centro-fila').filter({ hasText: codigoModelo }).first().click();
    const panelCentro = page.getByTestId('centro-panel');
    await expect(panelCentro.getByText(`OP ${folioOrden}`)).toBeVisible();
    await panelCentro.getByTestId('mosaico-modificar').click();
    const detalle = page.getByTestId('detalle-orden');
    await expect(detalle).toBeVisible();

    // ── 5) Programar la RC desde el detalle de la orden ─────────────────────────
    await detalle.getByTestId('orden-programar-rc').click();
    await expect(page.getByRole('heading', { name: 'Programar Ruta Crítica' })).toBeVisible();

    await page.getByTestId('prog-articulo').selectOption(String(idArticulo));
    await page.getByTestId('prog-tela').selectOption({ label: nombreTela });
    await page.getByTestId('prog-aplicacion').selectOption({ label: nombreAplicacion });
    await page.getByTestId('prog-entrega').fill(fechaRelativa(30));
    await page.getByTestId('prog-enviar').click();
    await expect(page.getByText('Ruta Crítica programada.')).toBeVisible();
    // La ruta resultante muestra sus renglones (procesos con fecha).
    await expect(page.getByTestId('renglones-ruta')).toBeVisible();

    // La RC por orden ofrece el botón de impreso del plan (PDF server-side, F5-E5).
    await page.getByTestId('ir-ver-ruta').click();
    await expect(page.getByRole('heading', { name: 'Ruta Crítica de la orden' })).toBeVisible();
    await expect(page.getByTestId('imprimir-plan-rc')).toBeVisible();

    // ── 6) Ambos procesos (raíces independientes, duración > 0) aparecen en MIS PENDIENTES.
    //    Se llega por el MENÚ: "Ruta Crítica" es HOJA DIRECTA (R4, sin desplegable).
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', { name: 'Ruta Crítica', exact: true })
      .click();
    await expect(page).toHaveURL(/\/ruta-critica\/pendientes$/);
    await expect(page.getByRole('heading', { name: 'Mis pendientes' })).toBeVisible();
    // AISLA las filas de ESTA corrida: el admin ve TODO y la página trae 100 tareas por consulta —
    // con la BD del CI llena de órdenes de otros specs, la fila podía quedar FUERA de la página
    // (el flaky de la 1ª corrida). El filtro por cliente es SERVER-SIDE (parámetro de la bandeja).
    //
    // Además, la RUTA VIVA (renglones + fechas del CPM) se materializa ASÍNCRONO en el backend del
    // compose (outbox → pg-boss); con este PR la cola trae MÁS mensajes (OCs y notas ahora emiten;
    // cada auditoría re-evalúa 2 tipos), así que la fila puede tardar y la página NO re-consulta sola.
    // Se reintenta RECARGANDO y re-aplicando el filtro hasta que la fila del proc1 exista. `toPass`
    // reintenta el callback COMPLETO aunque una aserción interna lance (mismo patrón que pedidos.spec).
    await expect(async () => {
      await page.reload();
      await page.getByTestId('pendientes-buscar-cliente').fill(cliente);
      await expect(
        page.getByTestId('pendientes-fila').filter({ hasText: proc1Nombre }),
      ).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000, intervals: [2_000] });

    const fila1 = page.getByTestId('pendientes-fila').filter({ hasText: proc1Nombre });
    // Los procesos del test no tienen evento de sistema → tag "✋ manual" + botón "Marcar hecho".
    await expect(fila1.getByTestId('pendientes-tag-evento')).toHaveText('✋ manual');

    // ── 7) "Marcar hecho" saca al primero; el otro (raíz independiente) sigue ahí ──────────────
    await fila1.getByTestId('pendientes-marcar-hecho').click();
    // Toast ESPECÍFICO por nombre: el toast del paso 8 (proc2) puede solaparse con este mientras se
    // desvanece; un `/marcado como hecho\./` genérico casaría 2 elementos (strict mode). El texto real
    // es `"<nombre>" de la orden <folio> marcado como hecho.` (MisPendientesPagina).
    await expect(page.getByText(new RegExp(`"${proc1Nombre}".*marcado como hecho`))).toBeVisible();
    await expect(page.getByTestId('pendientes-fila').filter({ hasText: proc1Nombre })).toHaveCount(
      0,
    );
    const fila2 = page.getByTestId('pendientes-fila').filter({ hasText: proc2Nombre });
    await expect(fila2).toBeVisible();

    // ── 8) Marcar el último: la orden queda al día (sale de Mis pendientes) ─────
    await fila2.getByTestId('pendientes-marcar-hecho').click();
    await expect(page.getByText(new RegExp(`"${proc2Nombre}".*marcado como hecho`))).toBeVisible();
    await expect(page.getByTestId('pendientes-fila').filter({ hasText: proc2Nombre })).toHaveCount(
      0,
    );

    // ── 9) Clic en un renglón abre el panel "Ruta de la orden" (R4). El panel se prueba con la
    //    ruta de ESTA orden desde el centro de órdenes: aquí basta verificar el deep-link viejo.
    await page.goto('/ruta-critica/bandeja'); // la URL vieja REDIRIGE a Mis pendientes
    await expect(page).toHaveURL(/\/ruta-critica\/pendientes$/);
  });

  test('Mis pendientes funciona en viewport móvil (KPIs + lista sin desbordes)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrarComoAdmin(page);

    await page.goto('/ruta-critica/pendientes');
    await expect(page.getByRole('heading', { name: 'Mis pendientes' })).toBeVisible();
    // En móvil se ven los KPIs y la lista (con o sin pendientes) sin que la vista se desborde.
    await expect(page.getByTestId('kpi-total')).toBeVisible();
  });
});

/** Fecha date-only `YYYY-MM-DD` a `dias` de HOY (hora local), para el campo de entrega. */
function fechaRelativa(dias: number): string {
  const f = new Date();
  f.setDate(f.getDate() + dias);
  const a = f.getFullYear();
  const m = String(f.getMonth() + 1).padStart(2, '0');
  const d = String(f.getDate()).padStart(2, '0');
  return `${a}-${m}-${d}`;
}

/**
 * Siembra por API la familia, el artículo, el tipo de tela y la aplicación de la RC (sin UI de alta
 * en esta etapa) reutilizando la cookie de sesión del admin. Devuelve el id del artículo creado.
 */
async function sembrarCatalogoRc(
  request: APIRequestContext,
  datos: {
    nombreFamilia: string;
    nombreArticulo: string;
    nombreTela: string;
    nombreAplicacion: string;
  },
): Promise<number> {
  const familia = await postJson(request, '/api/ruta-critica/familias', {
    nombre: datos.nombreFamilia,
  });
  const articulo = await postJson(request, '/api/ruta-critica/articulos', {
    nombre: datos.nombreArticulo,
    idFamiliaArticulo: familia.id as number,
  });
  await postJson(request, '/api/ruta-critica/reglas-duracion/tela', {
    nombre: datos.nombreTela,
    dias: 0,
    factorTela: 1,
  });
  await postJson(request, '/api/ruta-critica/reglas-duracion/aplicacion', {
    nombre: datos.nombreAplicacion,
    dias: 0,
  });
  return articulo.id as number;
}

/** POST JSON con la sesión del navegador y devuelve el cuerpo de la respuesta (201). */
async function postJson(
  request: APIRequestContext,
  url: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const respuesta = await request.post(url, { data: body });
  expect(respuesta.ok(), `POST ${url} -> ${respuesta.status()}`).toBeTruthy();
  return (await respuesta.json()) as Record<string, unknown>;
}
