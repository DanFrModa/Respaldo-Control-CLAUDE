import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del módulo LISTAS DE PRECIOS (F8-E4) contra el stack real. Cubre el ciclo del spec: preparar un
 * cliente + departamento + factores, un modelo con precosto CONGELADO (vía maquila), crear la lista
 * desde los candidatos, aprobar un renglón y comprobar que el PDF sale. Todo con datos únicos por
 * corrida (no depende del estado previo). Asume el admin sembrado (todos los permisos).
 */
test.describe('Listas de precios (F8-E4)', () => {
  test('capturar factores → congelar precosto → crear lista → aprobar → PDF', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `Cliente Lista ${sufijo}`;
    const departamento = `NIÑOS ${sufijo}`;
    const codigoModelo = `LST-${sufijo}`;
    const nombreProyecto = `Lista ${sufijo}`;

    await entrarComoAdmin(page);

    // ── Cliente + departamento ──────────────────────────────────────────────────
    await page.goto('/catalogos/clientes');
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

    // ── Factores por defecto del cliente (margen 50%, resto 0) ───────────────────
    const formFactores = page.getByTestId('form-factores-default');
    await formFactores.getByLabel('Margen %').fill('50');
    await page.getByTestId('guardar-factores-default').click();
    await expect(page.getByText('Factores por defecto guardados.')).toBeVisible();

    // ── Modelo ──────────────────────────────────────────────────────────────────
    await page.goto('/modelos');
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(codigoModelo);
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoModelo}" creado.`)).toBeVisible();

    // ── Proyecto + desarrollo ───────────────────────────────────────────────────
    await page.goto('/desarrollo');
    await page.getByTestId('nuevo-proyecto').click();
    const dialogoProyecto = page.getByRole('dialog');
    await dialogoProyecto.getByLabel('Cliente').selectOption({ label: cliente });
    await dialogoProyecto.getByLabel('Departamento').selectOption({ label: departamento });
    await dialogoProyecto.getByLabel('Nombre / tema').fill(nombreProyecto);
    await page.getByTestId('guardar-proyecto').click();
    await expect(page.getByText(/Proyecto \d+ creado\./)).toBeVisible();

    const detalleProyecto = page.getByTestId('detalle-proyecto');
    await page.getByTestId('fila-proyecto').filter({ hasText: nombreProyecto }).first().click();
    await detalleProyecto.getByTestId('agregar-desarrollo').click();
    const dialogoDesarrollo = page.getByRole('dialog');
    await dialogoDesarrollo.getByLabel('Modelo del catálogo').selectOption({ label: codigoModelo });
    await page.getByTestId('guardar-desarrollo').click();
    await expect(page.getByText('Desarrollo agregado.')).toBeVisible();

    // ── Precosto: generar → poner maquila 50 → congelar ─────────────────────────
    await detalleProyecto
      .getByTestId('fila-desarrollo')
      .filter({ hasText: codigoModelo })
      .getByTestId('precostear-desarrollo')
      .click();
    const dialogoPrecosto = page.getByRole('dialog');
    await dialogoPrecosto.getByTestId('generar-precosto').click();
    await expect(page.getByText(/Precosto v1 generado\./)).toBeVisible();

    // Edita la maquila a 50 (para que el costo > 0 y el precio calculado = 100 con margen 50%).
    await dialogoPrecosto.getByTestId('grupo-maquila').getByTestId('editar-linea').click();
    await dialogoPrecosto.getByTestId('editar-linea-precio').fill('50');
    await dialogoPrecosto.getByTestId('guardar-linea').click();

    await dialogoPrecosto.getByTestId('congelar-precosto').click();
    await dialogoPrecosto.getByTestId('confirmar-precosto').click();
    await expect(page.getByText(/Precosto v1 congelado\./)).toBeVisible();
    await page.keyboard.press('Escape');

    // ── Crear la lista desde los candidatos ─────────────────────────────────────
    await page.goto('/listas-precios');
    await expect(page.getByRole('heading', { name: 'Listas de precios' })).toBeVisible();
    await page.getByTestId('nuevo-lista-precios').click();
    const dialogoLista = page.getByRole('dialog');
    await dialogoLista.getByLabel('Cliente').selectOption({ label: cliente });
    await dialogoLista.getByLabel('Departamento').selectOption({ label: departamento });

    const candidato = dialogoLista.getByTestId('fila-candidato').filter({ hasText: codigoModelo });
    await expect(candidato).toBeVisible();
    await candidato.getByRole('checkbox').check();

    // Captura el id de la lista de la respuesta del POST (no del DOM): el body es la lista completa.
    const [crearResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/listas-precios') && r.request().method() === 'POST' && r.ok(),
      ),
      page.getByTestId('confirmar-crear-lista').click(),
    ]);
    const listaId = ((await crearResp.json()) as { id: number }).id;
    await expect(page.getByText(/Lista #\d+ creada\./)).toBeVisible();

    // Selecciona la lista recién creada (por el nombre del cliente, único por corrida).
    await page.getByTestId('fila-lista-precios').filter({ hasText: cliente }).first().click();

    // ── Aprobar el renglón ──────────────────────────────────────────────────────
    const detalleLista = page.getByTestId('detalle-lista-precios');
    const renglon = detalleLista
      .getByTestId('fila-renglon-lista')
      .filter({ hasText: codigoModelo });
    await expect(renglon).toBeVisible();
    await renglon.getByTestId('aprobar-renglon').click();
    await expect(page.getByText(`Renglón "${codigoModelo}" aprobado.`)).toBeVisible();
    await expect(renglon).toHaveAttribute('data-aprobado', 'true');
    // Con costo 50 y margen 50% el precio calculado/aprobado es $100.00. Se apunta al badge del
    // aprobado (evita strict mode: $100.00 aparece también en la celda del calculado).
    await expect(renglon.getByTestId('precio-aprobado')).toHaveText('$100.00');

    // ── El PDF sale (R9): el endpoint responde 200 con application/pdf ───────────
    // Se verifica con una request autenticada (comparte cookies de sesión), no vía popup:
    // en Chromium headless de CI no hay visor de PDF, así que el tab nunca navega a la URL.
    const pdf = await page.request.get(`/api/listas-precios/${String(listaId)}/pdf`);
    expect(pdf.ok()).toBeTruthy();
    expect(pdf.headers()['content-type']).toContain('application/pdf');
  });
});
