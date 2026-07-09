import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD de Proveedores contra el stack real, en la estructura LISTA +
 * DETALLE (rediseño "Teal fresco", mismo patron que Almacenes). Cubre el ciclo
 * completo: crear (con tipo) -> aparece en la lista -> seleccionar -> editar ->
 * se refleja -> desactivar (con confirmacion) -> queda oculto -> mostrar
 * desactivados -> **reactivar** -> vuelve a activo -> buscar. En esta UI se
 * SELECCIONA la fila (click) y las acciones (editar/desactivar/activar) son
 * botones DIRECTOS del detalle (ya no hay menu `acciones-proveedor`); el estado
 * Activo/Inactivo y el tipo se leen en el detalle. Usa un nombre unico por corrida.
 */
test.describe('CRUD de Proveedores', () => {
  test('crear, editar, desactivar, reactivar y buscar un proveedor', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Proveedor E2E ${sufijo}`;
    const nombreEditado = `${nombre} (editado)`;

    await entrarComoAdmin(page);

    // Navega Comercial -> Proveedores (acceso directo del menú nuevo).
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', { name: 'Proveedores', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();

    // El detalle vive en el CAJÓN deslizante (encabezado con nombre + estado, cuerpo con
    // el testid `detalle-proveedor`); se scopea a todo el cajón para leer ambos.
    const detalle = page.locator('[data-slot="cajon-detalle"]');

    // ── Crear ─────────────────────────────────────────────────────────────────
    await page.getByTestId('nuevo-proveedor').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nuevo proveedor' })).toBeVisible();
    await dialogoAlta.getByLabel('Nombre').fill(nombre);
    await dialogoAlta.getByLabel('Tipo').selectOption('AVIOS');
    // Crear ahora exige >=1 rol (R15): marca el primero del selector (abierto por defecto).
    await dialogoAlta.getByTestId('selector-roles-proveedor').getByRole('checkbox').first().check();
    await page.getByTestId('guardar-proveedor').click();

    // El toast confirma y la fila aparece en la lista; la busqueda la aisla.
    await expect(page.getByText(`Proveedor "${nombre}" creado.`)).toBeVisible();
    await page.getByTestId('buscar-proveedor').fill(nombre);
    const filaNueva = page.getByTestId('fila-proveedor').filter({ hasText: nombre });
    await expect(filaNueva).toBeVisible();

    // ── Seleccionar → el detalle muestra el proveedor (tipo y estado) ──────────
    await filaNueva.click();
    await expect(detalle.getByRole('heading', { name: nombre })).toBeVisible();
    await expect(detalle.getByText('Avíos').first()).toBeVisible();
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();

    // ── Editar (boton directo del detalle) ─────────────────────────────────────
    await page.getByTestId('editar-proveedor').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar proveedor' })).toBeVisible();
    await expect(dialogoEdicion.getByLabel('Nombre')).toHaveValue(nombre);
    await dialogoEdicion.getByLabel('Nombre').fill(nombreEditado);
    await page.getByTestId('guardar-proveedor').click();

    await expect(page.getByText(`Proveedor "${nombreEditado}" actualizado.`)).toBeVisible();
    await page.getByTestId('buscar-proveedor').fill(nombreEditado);
    const filaEditada = page.getByTestId('fila-proveedor').filter({ hasText: nombreEditado });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ─────────────────────────────────────────────
    await filaEditada.click();
    await expect(detalle.getByRole('heading', { name: nombreEditado })).toBeVisible();
    await page.getByTestId('desactivar-proveedor').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar proveedor' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Proveedor "${nombreEditado}" desactivado.`)).toBeVisible();
    // Por defecto la lista oculta desactivados: la fila ya no esta.
    await expect(page.getByTestId('fila-proveedor').filter({ hasText: nombreEditado })).toHaveCount(
      0,
    );

    // ── Mostrar desactivados → seleccionar → el detalle lo marca Inactivo ──────
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-proveedor').filter({ hasText: nombreEditado });
    await expect(filaInactiva).toBeVisible();
    await filaInactiva.click();
    await expect(detalle.getByText('Inactivo', { exact: true })).toBeVisible();

    // ── Reactivar (boton directo del detalle) ──────────────────────────────────
    await page.getByTestId('activar-proveedor').click();

    await expect(page.getByText(`Proveedor "${nombreEditado}" activado.`)).toBeVisible();
    // El detalle ahora lo marca Activo. `exact` evita que "Activo" haga match con
    // "Inactivo" (substring).
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();
    await expect(detalle.getByText('Inactivo', { exact: true })).toHaveCount(0);

    // ── Buscar ─────────────────────────────────────────────────────────────────
    await page.getByTestId('buscar-proveedor').fill(nombreEditado);
    await expect(
      page.getByTestId('fila-proveedor').filter({ hasText: nombreEditado }),
    ).toBeVisible();
    // Una busqueda que no coincide deja la lista vacia (estado vacio).
    await page.getByTestId('buscar-proveedor').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay proveedores que coincidan con la búsqueda.')).toBeVisible();
  });

  test('el filtro por tipo acota la lista', async ({ page }) => {
    await entrarComoAdmin(page);
    await page.goto('/catalogos/proveedores');
    await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();

    await page.getByTestId('filtro-tipo-proveedor').selectOption('TELAS');
    // El filtro recarga la lista en el servidor (tabla-first, sin auto-selección). Se
    // verifica que los renglones muestren el tipo "Telas" (su badge) o, si el catálogo no
    // tiene proveedores TELAS, que quede el estado vacío: ambos resultados son válidos.
    await expect(
      page
        .getByTestId('fila-proveedor')
        .filter({ hasText: 'Telas' })
        .first()
        .or(page.getByText('No hay proveedores que coincidan con la búsqueda.')),
    ).toBeVisible();
  });
});

/**
 * E2E del proveedor ENRIQUECIDO (F1-E1B, R15): crear con ≥1 rol + datos fiscales
 * desde las secciones plegables, verlo en la lista y en el detalle (chips de rol),
 * y filtrar la lista por rol. El selector de roles ('Roles / servicios') va abierto
 * por defecto en el diálogo; las secciones (Fiscal, etc.) se expanden con clic.
 */
test.describe('Proveedor enriquecido (R15)', () => {
  test('crear con 2 roles + datos fiscales, verlo en la lista y filtrar por rol', async ({
    page,
  }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Proveedor R15 ${sufijo}`;

    await entrarComoAdmin(page);
    await page.goto('/catalogos/proveedores');
    await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();

    // ── Crear con roles + fiscal ────────────────────────────────────────────────
    await page.getByTestId('nuevo-proveedor').click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo.getByRole('heading', { name: 'Nuevo proveedor' })).toBeVisible();
    await dialogo.getByLabel('Nombre').fill(nombre);

    // La sección de roles está abierta por defecto: marca los DOS primeros roles.
    const selectorRoles = dialogo.getByTestId('selector-roles-proveedor');
    const opcionesRol = selectorRoles.getByRole('checkbox');
    await opcionesRol.nth(0).check();
    await opcionesRol.nth(1).check();
    // Recuerda el nombre del primer rol para filtrar luego por él.
    const nombrePrimerRol = (await selectorRoles.locator('label').first().innerText()).trim();

    // Expande "Fiscal" y captura RFC + régimen (forma de persona moral: 12 chars).
    await dialogo.getByRole('button', { name: 'Fiscal' }).click();
    await dialogo.getByTestId('proveedor-factura').check();
    await dialogo.getByLabel('RFC').fill('ABC120101T1A');
    await dialogo.getByLabel('Régimen fiscal (SAT)').fill('601');

    await page.getByTestId('guardar-proveedor').click();

    // ── Aparece en la lista ─────────────────────────────────────────────────────
    await expect(page.getByText(`Proveedor "${nombre}" creado.`)).toBeVisible();
    await page.getByTestId('buscar-proveedor').fill(nombre);
    const fila = page.getByTestId('fila-proveedor').filter({ hasText: nombre });
    await expect(fila).toBeVisible();

    // ── Detalle: los roles se ven como chips ────────────────────────────────────
    await fila.click();
    // El detalle vive en el CAJÓN deslizante (encabezado con nombre + estado, cuerpo con
    // el testid `detalle-proveedor`); se scopea a todo el cajón para leer ambos.
    const detalle = page.locator('[data-slot="cajon-detalle"]');
    await expect(detalle.getByRole('heading', { name: nombre })).toBeVisible();
    await expect(detalle.getByTestId('roles-proveedor-detalle')).toBeVisible();
    await expect(
      detalle.getByTestId('roles-proveedor-detalle').getByText(nombrePrimerRol),
    ).toBeVisible();

    // ── Filtrar por rol ─────────────────────────────────────────────────────────
    // Limpia la búsqueda y filtra por el rol marcado: la lista lo sigue mostrando.
    await page.getByTestId('buscar-proveedor').fill('');
    await page.getByTestId('filtro-rol-proveedor').selectOption({ label: nombrePrimerRol });
    await page.getByTestId('buscar-proveedor').fill(nombre);
    await expect(page.getByTestId('fila-proveedor').filter({ hasText: nombre })).toBeVisible();
  });

  test('adjuntar un PDF (red de R2 mockeada) lo lista y se puede quitar', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Proveedor Adjunto ${sufijo}`;

    await entrarComoAdmin(page);
    await page.goto('/catalogos/proveedores');
    await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();

    // Crea un proveedor mínimo (con un rol) para poder adjuntar en edición.
    await page.getByTestId('nuevo-proveedor').click();
    const dialogoAlta = page.getByRole('dialog');
    await dialogoAlta.getByLabel('Nombre').fill(nombre);
    await dialogoAlta.getByTestId('selector-roles-proveedor').getByRole('checkbox').first().check();
    await page.getByTestId('guardar-proveedor').click();
    await expect(page.getByText(`Proveedor "${nombre}" creado.`)).toBeVisible();

    await page.getByTestId('buscar-proveedor').fill(nombre);
    await page.getByTestId('fila-proveedor').filter({ hasText: nombre }).click();

    // ── Mockea SOLO el PUT a R2 (la URL prefirmada), sin tocar el backend ────────
    // El flujo de subida es: POST /api/.../adjuntos (backend real) → devuelve una
    // `urlSubida` prefirmada de R2 → el navegador hace PUT directo a esa URL. Aquí
    // interceptamos UNICAMENTE ese PUT externo (no es `/api/`) y lo resolvemos 200,
    // para no depender de R2 real; el resto de la red (POST/GET/DELETE del backend)
    // pasa intacta (`fallback`).
    await page.route('**/*', (route) => {
      const peticion = route.request();
      const esPutAR2 = peticion.method() === 'PUT' && !peticion.url().includes('/api/');
      return esPutAR2 ? route.fulfill({ status: 200 }) : route.fallback();
    });

    // Abre la edición y expande Adjuntos.
    await page.getByTestId('editar-proveedor').click();
    const dialogoEdicion = page.getByRole('dialog');
    await dialogoEdicion.getByRole('button', { name: 'Adjuntos' }).click();
    await expect(dialogoEdicion.getByTestId('adjuntador-proveedor')).toBeVisible();

    // Elige tipo y sube un PDF en memoria (sin archivo en disco).
    await dialogoEdicion.getByTestId('adjunto-tipo').selectOption('CONSTANCIA');
    await dialogoEdicion.getByTestId('adjunto-archivo').setInputFiles({
      name: 'constancia.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 contenido de prueba'),
    });

    // El adjunto aparece listado; luego se quita. Se apunta al link del adjunto dentro del diálogo
    // (no a `getByText('constancia.pdf')`, que además casa con el toast "Adjunto ... subido." → strict
    // mode intermitente según si el toast sigue visible).
    await expect(dialogoEdicion.getByTestId('descargar-adjunto')).toBeVisible();
    const fila = dialogoEdicion.getByTestId('fila-adjunto').filter({ hasText: 'constancia.pdf' });
    await expect(fila).toBeVisible();
    await fila.getByTestId('quitar-adjunto').click();
    await expect(page.getByText('Adjunto "constancia.pdf" eliminado.')).toBeVisible();
  });
});
