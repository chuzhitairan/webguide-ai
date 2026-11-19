import { createRoot } from 'react-dom/client';
import { App } from '../../src/sidepanel/App.js';
import '../../src/sidepanel/styles.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);