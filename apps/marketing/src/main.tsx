import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@balo/design-system/tokens.css';
import './styles.css';
import { MarketingApp } from './MarketingApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MarketingApp />
  </StrictMode>,
);
