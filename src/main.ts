/** The only place that wires the app together (docs/architecture.md §1). */
import './style.css';
import { formatMessage, loadTheme } from './theme';

// Start page of release 0.1: no data layer yet, so no adapter is chosen here.
const theme = loadTheme('minimal');
const text = (key: string, params?: Record<string, string>) => formatMessage(theme, key, params);

function element(tag: string, content: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

document.title = text('app.name');
document
  .getElementById('app')
  ?.append(
    element('h1', text('app.name')),
    element('p', text('app.underConstruction')),
    element('p', text('app.version', { version: __APP_VERSION__ }), 'version'),
  );
