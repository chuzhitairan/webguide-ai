import { createRoot } from 'react-dom/client';
import '../../src/sidepanel/styles.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <main className="panel">
      <h1>WebGuide AI</h1>
    </main>,
  );
}
