import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme } from '@binarii/processii/ui';

// Default theme values embedded in the package (ADR 0006 theming contract): this app is
// self-sufficient and must NOT import ui-kit styles (same CSS variables, same selectors).
import '@binarii/processii/styles.css';
import './styles.css';

import { App } from './app.js';
import { createWiring } from './bootstrap.js';
import { loadIdentity } from './lib/identity.js';
import { readInitialTheme } from './lib/use-theme.js';

// Sets the initial theme on <html> before the first render (avoids a flash).
applyTheme(readInitialTheme());

const wiring = createWiring();

// Local presence identity (public site, no auth — docs/01): persisted, editable name + color
// (see `lib/identity`). On first load, an "Invité-XXXX" name is generated so peers do not all
// look identical.
const participant = loadIdentity();

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine #root introuvable.');

createRoot(container).render(
  <StrictMode>
    <App wiring={wiring} participant={participant} />
  </StrictMode>,
);
