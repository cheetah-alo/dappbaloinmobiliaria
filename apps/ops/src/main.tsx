import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@balo/design-system/tokens.css';
import './styles.css';
import { OpsApp } from './OpsApp';

createRoot(document.getElementById('root')!).render(<StrictMode><OpsApp /></StrictMode>);
