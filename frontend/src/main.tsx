import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Fuente Inter Variable (peso completo en un solo archivo): la tipografia del
// rediseño "Teal fresco". Se importa antes de la hoja de estilos para que
// `--font-sans` ('Inter Variable', …) ya tenga la fuente disponible.
import '@fontsource-variable/inter';

import { App } from './App.tsx';
import './index.css';

const contenedor = document.getElementById('root');
if (!contenedor) {
  throw new Error('No se encontro el elemento #root en index.html');
}

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
