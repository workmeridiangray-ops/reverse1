import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { SCREENS } from './registry';
import './styles.css';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

(window as unknown as { __SCREENS__: unknown }).__SCREENS__ = SCREENS.map(({ path, area, urls, title, sec }) => ({ path, area, urls, title, sec }));
