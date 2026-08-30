import { useState } from 'react';
import { landingContent } from './content';
import { LeadForm } from './LeadForm';
import { whatsappHref } from './runtime';

const logoUrl = `${import.meta.env.BASE_URL}balo-logo.svg`;
const homeImageUrl = `${import.meta.env.BASE_URL}images/familia-en-casa-pexels-andrea-piacquadio.jpg`;

function Brand() {
  return (
    <a className="brand" href="#inicio" aria-label="Balo Inmobiliaria, inicio">
      <img src={logoUrl} alt="Balo" />
      <span>Inmobiliaria<br />bienes raíces</span>
    </a>
  );
}

export function MarketingApp() {
  const [menuOpen, setMenuOpen] = useState(false);
  const whatsapp = whatsappHref();

  return (
    <div className="site-shell">
      <div className="announcement">{landingContent.announcement}</div>
      <header className="site-header">
        <div className="shell nav-wrap">
          <Brand />
          <button className="menu-toggle" type="button" aria-label="Abrir navegación" aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen((value) => !value)}>
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
          <nav id="primary-navigation" className={menuOpen ? 'nav-links open' : 'nav-links'} aria-label="Navegación principal">
            {landingContent.navigation.map((item) => <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}</a>)}
          </nav>
          <a className="button button-primary nav-cta" href="#contacto">Habla con Orlando</a>
        </div>
      </header>

      <main>
        <section className="hero" id="inicio">
          <div className="shell hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">{landingContent.hero.eyebrow}</p>
              <h1>{landingContent.hero.titleStart}<br /><em>{landingContent.hero.titleEmphasis}</em><br />{landingContent.hero.titleEnd}</h1>
              <p className="hero-intro">{landingContent.hero.body}</p>
              <div className="hero-actions">
                <a className="button button-accent" href="#contacto">{landingContent.hero.primaryAction}<span aria-hidden="true">→</span></a>
                <a className="button button-quiet" href="#metodo">{landingContent.hero.secondaryAction}</a>
              </div>
              <p className="reassurance"><span aria-hidden="true" />{landingContent.hero.reassurance}</p>
            </div>
            <aside className="editorial-note" aria-label="Forma de atención Balo">
              <figure className="editorial-photo">
                <img
                  src={homeImageUrl}
                  alt="Familia joven compartiendo un momento cotidiano en casa."
                  width="1800"
                  height="1200"
                  fetchPriority="high"
                />
                <figcaption>Imagen de ambiente · Andrea Piacquadio / Pexels</figcaption>
              </figure>
              <div className="note-content">
                <small>{landingContent.hero.noteLabel}</small>
                <strong>{landingContent.hero.noteTitle}</strong>
                <p>{landingContent.hero.noteBody}</p>
                <span>{landingContent.hero.noteSignature}</span>
              </div>
            </aside>
          </div>
        </section>

        <section className="principles" aria-label="Principios de atención Balo">
          <div className="shell principles-grid">
            {landingContent.principles.map((item) => <article key={item.label}><span>{item.label}</span><p>{item.text}</p></article>)}
          </div>
        </section>

        <section className="selling section" id="vender">
          <div className="shell">
            <header className="section-head">
              <div><p className="eyebrow">{landingContent.selling.eyebrow}</p><h2>{landingContent.selling.title}</h2></div>
              <p>{landingContent.selling.intro}</p>
            </header>
            <div className="value-grid">
              {landingContent.selling.points.map((point) => <article className="value-item" key={point.number}><span>{point.number} / {point.label}</span><h3>{point.title}</h3><p>{point.text}</p></article>)}
            </div>
          </div>
        </section>

        <section className="method section" id="metodo">
          <div className="shell method-grid">
            <div className="method-intro">
              <p className="eyebrow">{landingContent.method.eyebrow}</p>
              <h2>{landingContent.method.title}</h2>
              <p>{landingContent.method.intro}</p>
              <a className="button button-primary" href="#contacto">Conversemos sobre tu propiedad<span aria-hidden="true">→</span></a>
            </div>
            <ol className="steps">
              {landingContent.method.steps.map((step) => <li key={step.number}><span>{step.number}</span><div><h3>{step.title}</h3><p>{step.text}</p></div><em>{step.label}</em></li>)}
            </ol>
          </div>
        </section>

        <section className="buying section" id="comprar">
          <div className="shell">
            <header className="section-head inverse">
              <div><p className="eyebrow">{landingContent.buying.eyebrow}</p><h2>{landingContent.buying.title}</h2></div>
              <p>{landingContent.buying.intro}</p>
            </header>
            <div className="buying-grid">
              {landingContent.buying.stages.map((stage) => <article key={stage.number}><span>{stage.number}</span><h3>{stage.title}</h3><p>{stage.text}</p></article>)}
            </div>
          </div>
        </section>

        <section className="follow-up section">
          <div className="shell follow-up-panel">
            <div className="follow-up-copy">
              <p className="eyebrow">{landingContent.followUp.eyebrow}</p>
              <h2>{landingContent.followUp.title}</h2>
              <p>{landingContent.followUp.body}</p>
            </div>
            <div className="follow-up-list">
              {landingContent.followUp.items.map((item, index) => <article key={item.label}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{item.label}</strong><p>{item.text}</p></div></article>)}
            </div>
          </div>
        </section>

        <section className="contact section" id="contacto">
          <div className="shell contact-grid">
            <div className="contact-copy">
              <p className="eyebrow">{landingContent.contact.eyebrow}</p>
              <h2>{landingContent.contact.title}</h2>
              <p>{landingContent.contact.body}</p>
              <div className="contact-links">
                <a className="direct-link" href={whatsapp} target="_blank" rel="noreferrer">Escribir por WhatsApp<span aria-hidden="true">↗</span></a>
                {landingContent.contact.links.map((link) => <a key={link.href} className="direct-link secondary" href={link.href} target="_blank" rel="noreferrer">{link.label}<span aria-hidden="true">↗</span></a>)}
              </div>
            </div>
            <LeadForm />
          </div>
        </section>
      </main>

      <footer>
        <div className="shell footer-inner"><Brand /><small>{landingContent.footer}</small></div>
      </footer>
    </div>
  );
}
