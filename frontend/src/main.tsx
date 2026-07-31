import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import './index.css';
import { instalarSinIncrementosNumericos } from './lib/sin-incrementos-numericos.ts';

// Los campos numéricos no cambian de valor con la rueda del mouse ni con las flechas del teclado
// (la contraparte en JS de las "flechitas" que se apagaron en `index.css`).
instalarSinIncrementosNumericos();

const contenedor = document.getElementById('root');
if (!contenedor) {
  throw new Error('No se encontro el elemento #root en index.html');
}

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
