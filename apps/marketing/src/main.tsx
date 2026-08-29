import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { MarketingApp } from './MarketingApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MarketingApp />
  </StrictMode>,
);
