import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { OpsApp } from './OpsApp';

createRoot(document.getElementById('root')!).render(<StrictMode><OpsApp /></StrictMode>);
