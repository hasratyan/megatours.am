"use client";

import Link from "next/link";
import Header from "@/components/header";
import HotelCard from "@/components/hotel-card";
import SearchForm from "@/components/search-form";
import CurvedLoop from '@/components/CurvedLoop';
import ShinyText from '@/components/ShinyText';
import { useTranslations } from "@/components/language-provider";
import { hotels } from "@/lib/hotels";

export default function Home() {
  const t = useTranslations();

  return (
    <div className="page">
      {/* Skip link for accessibility - keyboard navigation */}
      <Link href="#main-content" className="skip-link">
        {t.accessibility.skipToContent}
      </Link>
      {/* <div className="glow">
        <span className="glow-a" />
        <span className="glow-b" />
        <span className="glow-c" />
      </div> */}
      <div className="videoWrap">
        <video src="/uae.mp4" autoPlay muted loop playsInline />
      </div>
      <Header />
      <main id="main-content" role="main">
        <div className="container">
          <div id="hero">
            <div className="search">
              {/*<h1>{t.hero.title}</h1>*/}
              <ShinyText
                text={t.hero.title}
                disabled={false}
                speed={3}
              />
              <h3>{t.hero.subtitle}</h3>
              <SearchForm copy={t.search} />
            </div>
          </div>
        </div>

        <CurvedLoop
          marqueeText={t.hero.marquee}
          speed={0.4}
          curveAmount={-200}
          direction="left"
          interactive={true}
        />

        <div className="container">
          {/* Featured Hotels Section */}
          <section id="featured" aria-labelledby="featured-title">
            <h2>{t.featured.title}</h2>
            <p>{t.featured.subtitle}</p>
            <Link href={"#"}><span className="material-symbols-rounded">redeem</span>{t.featured.cta}</Link>
            <div className="hotels">
              {hotels.map((hotel) => (
                <HotelCard key={hotel.id} hotel={hotel} copy={t.card} />
              ))}
            </div>
          </section>
          <div className="section-divider" role="separator" aria-hidden="true"></div>
          {/* Services Section */}
          <section id="services" aria-labelledby="services-title">
            <h2 className="section-title">{t.services.title}</h2>
            <div className="grid" role="list" aria-label={t.accessibility.servicesSection}>
              {t.services.items.map((service) => (
                <article key={service.title} role="listitem" tabIndex={0}>
                  <div className="service-icon" aria-hidden="true">
                    <span className="material-symbols-rounded">{service.icon}</span>
                  </div>
                  <h3>{service.title}</h3>
                  <p>{service.description}</p>
                </article>
              ))}
            </div>
          </section>
        </div>

        {/* Bundle & Save Section */}
        <section id="bundle" aria-labelledby="bundle-title">
          <span className="savings-badge" role="status" aria-live="polite">
            <span className="material-symbols-rounded" aria-hidden="true">local_offer</span>
            {t.bundleSave.savings}
          </span>
          <h2>{t.bundleSave.title}</h2>
          <div className="features" role="list" aria-label={t.accessibility.bundleSection}>
            {t.bundleSave.features.map((feature) => (
              <article key={feature.title} role="listitem">
                <div className="icon" aria-hidden="true">
                  <span className="material-symbols-rounded">{feature.icon}</span>
                </div>
                <h4>{feature.title}</h4>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
          <Link href={"#hero"} className="btn-cta" aria-label={t.bundleSave.cta}>
            {t.bundleSave.cta}
          </Link>
        </section>

        {/* Trust Stats Section */}
        <div className="container">
          <section id="trust" aria-labelledby="trust-title">
            <h2>{t.trustStats.title}</h2>
            <div className="trust-stats-grid" role="list">
              {t.trustStats.stats.map((stat) => (
                <div key={stat.label} className="trust-stat" role="listitem">
                  <p className="trust-stat-value">{stat.value}</p>
                  <p className="trust-stat-label">{stat.label}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="section-divider" role="separator" aria-hidden="true"></div>

        <div className="container">
          <section id="offers" className="section" aria-labelledby="offers-title">
            <div className="section-header">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>{t.exclusives.tag}</p>
                <h2 className="section-title">{t.exclusives.title}</h2>
                <p className="section-subtitle">{t.exclusives.subtitle}</p>
              </div>
              <button className="btn">{t.exclusives.cta}</button>
            </div>
            <div className="offers-grid" style={{ marginTop: 12 }}>
              {t.exclusives.offers.map((offer) => (
                <div key={offer.title} className="offer-card">
                  <div className="offer-inner">
                    <div className="offer-meta">
                      <span className="badge">{offer.badge}</span>
                      <span className="eyebrow" style={{ color: "#cbd5e1" }}>
                        {t.labels.exclusive}
                      </span>
                    </div>
                    <h3 className="heading-sm">{offer.title}</h3>
                    <p className="text-muted">{offer.description}</p>
                    <button className="btn btn-primary" type="button">
                      {offer.cta}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section id="how" className="section" aria-labelledby="how-title">
            <div className="section-header" style={{ alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ display: "inline-block", width: 40, height: 4, borderRadius: 4, background: "#7cf2d4" }} />
                <p className="eyebrow" style={{ margin: 0 }}>
                  {t.steps.tag}
                </p>
              </div>
            </div>
            <div className="steps-grid" style={{ marginTop: 16 }}>
              {t.steps.items.map((step, idx) => (
                <div key={step.title} className="step-card">
                  <div className="step-index">{idx + 1}</div>
                  <h3 className="heading-sm">{step.title}</h3>
                  <p className="text-muted" style={{ marginTop: 8 }}>{step.description}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="perks" className="section" aria-labelledby="perks-title">
            <div className="perks-grid">
              <div className="card" style={{ boxShadow: "none" }}>
                <p className="eyebrow" style={{ margin: 0 }}>{t.perks.tag}</p>
                <h3 className="section-title" style={{ marginTop: 8 }}>{t.perks.title}</h3>
                <p className="section-subtitle">{t.perks.subtitle}</p>
                <div className="cards-grid" style={{ marginTop: 12 }}>
                  {t.perks.items.map((perk) => (
                    <div key={perk.title} className="perk-card">
                      <p className="heading-sm" style={{ fontSize: 16 }}>{perk.title}</p>
                      <p className="text-muted" style={{ marginTop: 6 }}>{perk.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section id="faq" className="section" aria-labelledby="faq-title">
            <div className="section-header">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>{t.faq.tag}</p>
                <h3 className="section-title">{t.faq.title}</h3>
                <p className="section-subtitle">{t.faq.subtitle}</p>
              </div>
            </div>
            <div className="faq-grid" style={{ marginTop: 16 }}>
              {t.faq.items.map((item) => (
                <div key={item} className="faq-item">
                  <div className="faq-icon">✓</div>
                  <p className="text-muted" style={{ marginTop: 8 }}>{item}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
