import { expect, test } from '@playwright/test';

import { entrarComoAdmin } from './ayudas';

/**
 * E2E del CRUD de Bordados/estampados (F1-E3) contra el stack real, en la estructura
 * LISTA + DETALLE ("Teal fresco"). Cubre el ciclo: crear un ESTAMPADO → aparece →
 * seleccionar → editar → se refleja → desactivar (con confirmacion) → oculto → mostrar
 * desactivados → reactivar → vuelve a activo → buscar. Las acciones (editar/desactivar/
 * activar) son botones DIRECTOS del detalle. Nombre unico por corrida.
 *
 * NOTA: requiere que la integracion haya cableado el plugin de rutas, los links de menu
 * (Catalogos → Bordados / Galería de bordados) y las rutas en App.tsx; de lo contrario
 * estas pruebas se omiten en CI hasta el cierre de integracion.
 */
test.describe('CRUD de Bordados', () => {
  test('crear un estampado, editar, desactivar, reactivar y buscar', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Bordado E2E ${sufijo}`;
    const nombreEditado = `${nombre} (editado)`;

    await entrarComoAdmin(page);

    // Navega Operación · Desarrollo -> Bordados (descubrible por clic).
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('button', { name: 'Desarrollo' })
      .click();
    await page
      .getByRole('navigation', { name: 'Módulos' })
      .first()
      .getByRole('link', { name: 'Bordados', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Bordados y estampados' })).toBeVisible();

    const detalle = page.getByTestId('detalle-bordado');

    // ── Crear un ESTAMPADO ──────────────────────────────────────────────────────
    await page.getByTestId('nuevo-bordado').click();
    const dialogoAlta = page.getByRole('dialog');
    await expect(dialogoAlta.getByRole('heading', { name: 'Nuevo bordado' })).toBeVisible();
    await dialogoAlta.getByLabel('Nombre').fill(nombre);
    await dialogoAlta.getByLabel('Tipo').selectOption('ESTAMPADO');
    await dialogoAlta.getByLabel('Puntadas').fill('12000');
    await page.getByTestId('guardar-bordado').click();

    await expect(page.getByText(`Bordado "${nombre}" creado.`)).toBeVisible();
    await page.getByTestId('buscar-bordado').fill(nombre);
    const filaNueva = page.getByTestId('fila-bordado').filter({ hasText: nombre });
    await expect(filaNueva).toBeVisible();

    // ── Seleccionar → el detalle muestra el bordado (tipo estampado, estado) ───
    await filaNueva.click();
    await expect(detalle.getByRole('heading', { name: nombre })).toBeVisible();
    await expect(detalle.getByText('Estampado / aplicación').first()).toBeVisible();
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();

    // ── Editar ──────────────────────────────────────────────────────────────────
    await page.getByTestId('editar-bordado').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByRole('heading', { name: 'Editar bordado' })).toBeVisible();
    await expect(dialogoEdicion.getByLabel('Nombre')).toHaveValue(nombre);
    await dialogoEdicion.getByLabel('Nombre').fill(nombreEditado);
    await page.getByTestId('guardar-bordado').click();

    await expect(page.getByText(`Bordado "${nombreEditado}" actualizado.`)).toBeVisible();
    await page.getByTestId('buscar-bordado').fill(nombreEditado);
    const filaEditada = page.getByTestId('fila-bordado').filter({ hasText: nombreEditado });
    await expect(filaEditada).toBeVisible();

    // ── Desactivar (borrado suave) ─────────────────────────────────────────────
    await filaEditada.click();
    await page.getByTestId('desactivar-bordado').click();
    const confirmacion = page.getByRole('dialog');
    await expect(confirmacion.getByRole('heading', { name: 'Desactivar bordado' })).toBeVisible();
    await page.getByTestId('confirmar-accion').click();

    await expect(page.getByText(`Bordado "${nombreEditado}" desactivado.`)).toBeVisible();
    await expect(page.getByTestId('fila-bordado').filter({ hasText: nombreEditado })).toHaveCount(
      0,
    );

    // ── Mostrar desactivados → reactivar ───────────────────────────────────────
    await page.getByTestId('mostrar-desactivados').click();
    const filaInactiva = page.getByTestId('fila-bordado').filter({ hasText: nombreEditado });
    await expect(filaInactiva).toBeVisible();
    await filaInactiva.click();
    await expect(detalle.getByText('Inactivo', { exact: true })).toBeVisible();
    await page.getByTestId('activar-bordado').click();

    await expect(page.getByText(`Bordado "${nombreEditado}" activado.`)).toBeVisible();
    await expect(detalle.getByText('Activo', { exact: true })).toBeVisible();

    // ── Buscar ─────────────────────────────────────────────────────────────────
    await page.getByTestId('buscar-bordado').fill('zzz-no-existe-zzz');
    await expect(page.getByText('No hay bordados que coincidan con la búsqueda.')).toBeVisible();
  });

  test('subir la foto de un bordado (red de R2 mockeada) y verla', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Bordado Foto ${sufijo}`;

    await entrarComoAdmin(page);
    await page.goto('/catalogos/bordados');
    await expect(page.getByRole('heading', { name: 'Bordados y estampados' })).toBeVisible();

    // Crea un bordado minimo para poder subir su foto en edicion.
    await page.getByTestId('nuevo-bordado').click();
    const dialogoAlta = page.getByRole('dialog');
    await dialogoAlta.getByLabel('Nombre').fill(nombre);
    await page.getByTestId('guardar-bordado').click();
    await expect(page.getByText(`Bordado "${nombre}" creado.`)).toBeVisible();

    await page.getByTestId('buscar-bordado').fill(nombre);
    await page.getByTestId('fila-bordado').filter({ hasText: nombre }).click();

    // ── Mockea SOLO el PUT a R2 (URL prefirmada), sin tocar el backend ───────────
    // El flujo es: POST /api/.../foto (backend real) → devuelve `urlSubida` de R2 → el
    // navegador hace PUT directo a esa URL. Interceptamos UNICAMENTE ese PUT externo
    // (no es `/api/`) y lo resolvemos 200; el resto de la red pasa intacta.
    await page.route('**/*', (route) => {
      const peticion = route.request();
      const esPutAR2 = peticion.method() === 'PUT' && !peticion.url().includes('/api/');
      return esPutAR2 ? route.fulfill({ status: 200 }) : route.fallback();
    });

    // Abre la edicion: la seccion Foto monta el componente SubidaImagen.
    await page.getByTestId('editar-bordado').click();
    const dialogoEdicion = page.getByRole('dialog');
    await expect(dialogoEdicion.getByTestId('subida-foto-bordado')).toBeVisible();
    // Sin foto aun: placeholder NoFoto.
    await expect(dialogoEdicion.getByTestId('placeholder-foto-bordado')).toBeVisible();

    // Sube una imagen PNG en memoria (sin archivo en disco). Un PNG 1x1 minimo.
    const pngMinimo = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    await dialogoEdicion.getByTestId('archivo-foto-bordado').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: pngMinimo,
    });

    // Tras subir: toast de exito y la imagen aparece (ya no el placeholder).
    await expect(page.getByText('Foto actualizada.')).toBeVisible();
    await expect(dialogoEdicion.getByTestId('imagen-foto-bordado')).toBeVisible();
  });
});

/**
 * E2E de la GALERIA de fotos de bordados: la rejilla visual paginada de servidor. Verifica
 * que carga, que la busqueda/filtro funcionan y que tocar una celda lleva a la ficha.
 */
test.describe('Galería de bordados', () => {
  test('la galería lista bordados y al tocar una celda abre la ficha', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const nombre = `Bordado Galería ${sufijo}`;

    await entrarComoAdmin(page);

    // Crea un bordado para asegurar que hay al menos uno en la galeria.
    await page.goto('/catalogos/bordados');
    await page.getByTestId('nuevo-bordado').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(nombre);
    await page.getByTestId('guardar-bordado').click();
    await expect(page.getByText(`Bordado "${nombre}" creado.`)).toBeVisible();

    // Navega a la galería desde el PORTAL de Catálogos: la tarjeta vive en `/catalogos`, no en la
    // pantalla de bordados donde quedamos tras crear el bordado.
    await page.goto('/catalogos');
    await expect(page.getByRole('heading', { name: 'Catálogos' })).toBeVisible();
    await page.getByTestId('catalogo-galeria-bordados').click();
    await expect(page.getByRole('heading', { name: 'Galería de bordados' })).toBeVisible();

    // Busca el bordado creado; su celda aparece.
    await page.getByTestId('buscar-galeria').fill(nombre);
    const celda = page.getByTestId('celda-galeria').filter({ hasText: nombre });
    await expect(celda).toBeVisible();

    // Al tocarla, lleva a la ficha (pantalla de bordados).
    await celda.click();
    await expect(page.getByRole('heading', { name: 'Bordados y estampados' })).toBeVisible();
  });
});
