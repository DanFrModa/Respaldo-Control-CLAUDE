import { expect, test, type APIRequestContext } from '@playwright/test';

import { crearColorYTalla, entrarComoAdmin } from './ayudas';

/**
 * E2E del MOTOR de la Ruta Crítica por orden (F5-E5) contra el stack real, en el estándar visual. El
 * primer test arma el ciclo COMPLETO de extremo a extremo:
 *   catálogo RC (familia/artículo/tela/aplicación vía API) + plantilla con 2 procesos (cada uno con
 *   duración > 0, sin encadenamiento entre sí) → cliente + modelo + pedido + orden con matriz (UI) →
 *   PROGRAMAR RC desde el detalle de la orden → ambos procesos quedan ACTIVOS en la Bandeja →
 *   capturar uno con "Hoy" lo saca de la bandeja → capturar el otro la vacía de esa orden.
 * (El encadenamiento real "la pelota pasa al siguiente" lo cubre un test de integración del backend.)
 * El segundo test verifica la Bandeja en viewport MÓVIL (cards con botones grandes).
 *
 * El catálogo RC (familia/artículo/tela/aplicación) NO tiene UI de alta en esta etapa: se siembra por
 * API reutilizando la cookie de sesión del admin (`page.request`). Sufijos únicos por corrida.
 */
test.describe('Ruta Crítica — motor por orden (F5-E5)', () => {
  test('programar una orden → ambos procesos activos en la bandeja → capturar uno y luego el otro la vacía', async ({
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

    await page.goto('/pedidos');
    await page.getByTestId('nuevo-pedido').click();
    const dialogoPedido = page.getByRole('dialog');
    await dialogoPedido.getByLabel('Cliente').selectOption({ label: cliente });
    await dialogoPedido.getByTestId('agregar-renglon').click();
    const filaRenglon = dialogoPedido.getByTestId('fila-renglon').first();
    await filaRenglon.getByLabel('Modelo del renglón').selectOption({ label: codigoModelo });
    await filaRenglon.getByLabel('Cantidad del renglón').fill('50');
    await page.getByTestId('guardar-pedido').click();
    await expect(page.getByText(/Pedido \d+ creado\./)).toBeVisible();

    await page.goto('/produccion/ordenes');
    await expect(page.getByRole('heading', { name: 'Órdenes' })).toBeVisible();
    await page.getByTestId('nuevo-orden').click();
    const dialogoAlta = page.getByRole('dialog');
    await dialogoAlta.getByTestId('orden-buscar-pedido').fill(cliente);
    await dialogoAlta.getByTestId('orden-pedido-opcion').first().click();
    await dialogoAlta.getByTestId('orden-renglon-opcion').first().click();
    await page.getByTestId('confirmar-nueva-orden').click();
    await expect(page.getByText(/Orden \d+ creada\./)).toBeVisible();

    const detalle = page.getByTestId('detalle-orden');
    const matriz = detalle.getByTestId('matriz-orden');
    await matriz.getByTestId('matriz-orden-agregar-color').selectOption({ index: 1 });
    const agregarTalla = matriz.getByTestId('matriz-orden-agregar-talla');
    if (await agregarTalla.isEnabled()) {
      await agregarTalla.selectOption({ index: 1 });
    }
    await matriz.getByTestId('matriz-orden-celda').first().fill('20');
    await detalle.getByTestId('guardar-matriz').click();
    await expect(page.getByText('Matriz guardada.')).toBeVisible();

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

    // ── 6) Ambos procesos (raíces independientes, duración > 0) aparecen ACTIVOS en la Bandeja ──
    await page.goto('/ruta-critica/bandeja');
    await expect(page.getByRole('heading', { name: 'Bandeja de tareas' })).toBeVisible();
    await page.getByTestId('bandeja-buscar-cliente').fill(cliente);
    const tarea1 = page.getByTestId('bandeja-tarea').filter({ hasText: proc1Nombre });
    await expect(tarea1).toBeVisible();

    // ── 7) Capturar uno con "Hoy" lo saca de la bandeja; el otro (ya activo) sigue ahí ──────────
    await tarea1.getByTestId('bandeja-completar-hoy').click();
    await expect(page.getByText(/completado\./)).toBeVisible();
    // El proceso 1 desaparece de la bandeja; el 2 (raíz independiente, ya estaba activo) sigue.
    await expect(page.getByTestId('bandeja-tarea').filter({ hasText: proc1Nombre })).toHaveCount(0);
    const tarea2 = page.getByTestId('bandeja-tarea').filter({ hasText: proc2Nombre });
    await expect(tarea2).toBeVisible();

    // ── 8) Capturar el último: la RC queda al día (esa orden sale de la bandeja) ─
    await tarea2.getByTestId('bandeja-completar-hoy').click();
    await expect(page.getByText(/completado\./)).toBeVisible();
    await expect(page.getByTestId('bandeja-tarea').filter({ hasText: proc2Nombre })).toHaveCount(0);
  });

  test('la Bandeja funciona en viewport móvil (cards con botones grandes)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrarComoAdmin(page);

    await page.goto('/ruta-critica/bandeja');
    await expect(page.getByRole('heading', { name: 'Bandeja de tareas' })).toBeVisible();
    // En móvil se ve la lista (con o sin tareas) sin que la tabla se desborde; el buscador responde.
    await expect(page.getByTestId('bandeja-buscar-cliente')).toBeVisible();
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
