"use client";

import Link from "next/link";
import Header from "@/components/header";
import HotelCard from "@/components/hotel-card";
import SearchForm from "@/components/search-form";
import CurvedLoop from '@/components/CurvedLoop';
import ShinyText from '@/components/ShinyText';
import { Marquee } from "@/components/ui/marquee";
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
          </section>
        </div>
        <div id="hotels">
          <Marquee reverse pauseOnHover={true}>
            {hotels.map((hotel) => (
              <HotelCard key={hotel.id} hotel={hotel} copy={t.card} />
            ))}
          </Marquee>
          <Marquee  pauseOnHover={true}>
            {hotels.map((hotel) => (
              <HotelCard key={hotel.id} hotel={hotel} copy={t.card} />
            ))}
          </Marquee>
        </div>
        <div className="container">
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
            <div className="grid" role="list">
              {t.trustStats.stats.map((stat) => (
                <div key={stat.label} className="trust-stat" role="listitem">
                  <span className="trust-stat-badge" aria-hidden="true">
                    <span className="material-symbols-rounded">{stat.icon}</span>
                  </span>
                  <p className="trust-stat-value">{stat.value}</p>
                  <p className="trust-stat-label">{stat.label}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div className="section-divider" role="separator" aria-hidden="true"></div>
        <div className="container">
          <div id="offers" className="grid" aria-labelledby="offers-title">
              {t.exclusives.offers.map((offer) => (
                <div key={offer.title} className="card">
                  <div className="inner">
                    <div className="meta">
                      <span className="badge">{offer.badge}</span>
                      <span className="eyebrow" style={{ color: "#cbd5e1" }}>
                        {t.labels.exclusive}
                      </span>
                    </div>
                    <h3>{offer.title}</h3>
                    <p>{offer.description}</p>
                    <button type="button">
                      {offer.cta} <span className="material-symbols-rounded">arrow_forward</span>
                    </button>
                  </div>
                </div>
              ))}
          </div>

          <section id="faq" aria-labelledby="faq-title">
            <h2>{t.perks.title}</h2>
            <div>
              {t.perks.items.map((perk) => (
                <details key={perk.title}>
                  <summary>
                    {perk.title}
                    <span className="material-symbols-rounded" aria-hidden="true">
                      keyboard_arrow_right
                    </span>
                  </summary>
                  <p>{perk.body}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </main>
      <footer>&copy; 2026 | MEGATOURS</footer>
    </div>
  );
}
