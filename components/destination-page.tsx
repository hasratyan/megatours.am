import Image from "next/image";
import Link from "next/link";
import { Bodoni_Moda, Outfit } from "next/font/google";
import type { Locale } from "@/lib/i18n";
import type { DestinationData } from "@/lib/destination-data";
import DestinationPageGsap from "@/components/destination-page-gsap";
import styles from "@/components/destination-page.module.css";

const displayFont = Bodoni_Moda({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-destination-display",
});

const bodyFont = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-destination-body",
});

const sectionCopy = {
  hy: {
    editorialLabel: "Destination Editorial",
    galleryTitle: "Պատկերասրահ",
    gallerySubtitle: "Քաղաքի տրամադրությունը` տեսարաններով և պահերով",
    videoTitle: "Տեսանյութ",
    videoSubtitle: "Կարճ դիտում ուղղության էներգիայի մասին",
    highlightsTitle: "Why This Destination",
    highlightsSubtitle: "Հիմնական պատճառները, թե ինչու են ընտրում այս ուղղությունը",
    socialProofTitle: "Ճանապարհորդի կարծիք",
    socialProofQuote:
      "Ստացվեց շատ հարմար ձևաչափ. ամեն ինչ մեկ էջում հասկանալի էր, իսկ ծրագիրը՝ հեշտ հարմարվող։",
    from: "Սկսած",
    perNight: " գիշեր",
  },
  en: {
    editorialLabel: "Destination Editorial",
    galleryTitle: "Gallery",
    gallerySubtitle: "The mood of the city through scenes and moments",
    videoTitle: "Video",
    videoSubtitle: "A quick feel of the destination energy",
    highlightsTitle: "Why This Destination",
    highlightsSubtitle: "Key reasons travelers choose this city",
    socialProofTitle: "Traveler Note",
    socialProofQuote:
      "Everything felt clear in one page, and the trip structure was easy to tailor.",
    from: "From",
    perNight: " night",
  },
  ru: {
    editorialLabel: "Destination Editorial",
    galleryTitle: "Галерея",
    gallerySubtitle: "Атмосфера города в кадрах и моментах",
    videoTitle: "Видео",
    videoSubtitle: "Короткий взгляд на энергетику направления",
    highlightsTitle: "Why This Destination",
    highlightsSubtitle: "Главные причины, почему выбирают этот город",
    socialProofTitle: "Отзыв путешественника",
    socialProofQuote:
      "Формат оказался очень удобным: все на одной странице и программу легко адаптировать.",
    from: "От",
    perNight: " ночь",
  },
} as const;

type DestinationPageProps = {
  locale: Locale;
  destination: DestinationData;
};

export default function DestinationPage({ locale, destination }: DestinationPageProps) {
  const hotels = destination.hotels.slice(0, 6);
  const copy = sectionCopy[locale];

  return (
    <main className={`${styles.shell} ${styles.fonts} ${displayFont.variable} ${bodyFont.variable}`} data-destination-page>
      <DestinationPageGsap />
      <div className={styles.ambientLayer} aria-hidden="true" />

      <section className={`${styles.band} ${styles.heroBand}`} data-gsap="hero-band">
        <Image
          src={destination.heroImage}
          alt={destination.name[locale]}
          fill
          priority
          className={styles.heroImage}
          data-gsap="hero-image"
          sizes="100vw"
        />
        <div className={styles.heroScrim} aria-hidden="true" />

        <div className={styles.content}>
          <div className={styles.heroLayout}>
            <article className={styles.heroMain}>
              <span className={styles.kicker} data-gsap="hero-kicker">{destination.heroTag[locale]}</span>
              <h1 data-gsap="hero-title">{destination.heroTitle[locale]}</h1>
              <p data-gsap="hero-summary">{destination.heroSummary[locale]}</p>
              <div className={styles.heroActions} data-gsap="hero-actions">
                <Link href={`/${locale}/results`} className={styles.primaryAction}>
                  {destination.ctaLabel[locale]}
                </Link>
                <span className={styles.locationChip}>
                  {destination.name[locale]} · {destination.country[locale]}
                </span>
              </div>
            </article>

            <aside className={styles.factPanel} data-gsap="hero-facts">
              <p className={styles.editorialLabel}>{copy.editorialLabel}</p>
              <dl className={styles.quickFacts}>
                {destination.facts.map((fact) => (
                  <div key={fact.label.en}>
                    <dt>{fact.label[locale]}</dt>
                    <dd>{fact.value[locale]}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          </div>
        </div>
      </section>

      <section className={`${styles.band} ${styles.storyBand}`} data-gsap="reveal-section">
        <div className={styles.content}>
          <div className={styles.storyLayout}>
            <article className={styles.storyCard} data-gsap-item>
              <h2>{destination.storyTitle[locale]}</h2>
              <p>{destination.storyBody[locale]}</p>
            </article>

            <article className={styles.socialProofCard} data-gsap-item>
              <p className={styles.socialProofLabel}>{copy.socialProofTitle}</p>
              <blockquote>{copy.socialProofQuote}</blockquote>
            </article>
          </div>
        </div>
      </section>

      <section className={`${styles.band} ${styles.highlightsBand}`} data-gsap="reveal-section">
        <div className={styles.content}>
          <div className={styles.sectionHeader} data-gsap="section-header">
            <h2>{copy.highlightsTitle}</h2>
            <p>{copy.highlightsSubtitle}</p>
          </div>
          <div className={styles.highlightsGrid}>
            {destination.highlights.map((highlight) => (
              <article key={highlight.title.en} className={styles.highlightCard} data-gsap-item>
                <h3>{highlight.title[locale]}</h3>
                <p>{highlight.description[locale]}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.band} ${styles.galleryBand}`} data-gsap="reveal-section">
        <div className={styles.content}>
          <div className={styles.sectionHeader} data-gsap="section-header">
            <h2>{copy.galleryTitle}</h2>
            <p>{copy.gallerySubtitle}</p>
          </div>

          <div className={styles.galleryMosaic}>
            {destination.gallery.map((item, index) => (
              <article
                key={`${item.src}-${index}`}
                className={styles[`tile${(index % 6) + 1}` as keyof typeof styles]}
                data-gsap-item
              >
                <Image
                  src={item.src}
                  alt={item.alt[locale]}
                  fill
                  className={styles.galleryImage}
                  sizes="(max-width: 760px) 100vw, 33vw"
                />
                <span>{item.alt[locale]}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.band} ${styles.videoBand}`} data-gsap="reveal-section">
        <div className={styles.content}>
          <div className={styles.sectionHeader} data-gsap="section-header">
            <h2>{copy.videoTitle}</h2>
            <p>{copy.videoSubtitle}</p>
          </div>

          <div className={styles.videoFrame} data-gsap-item>
            <video controls preload="metadata" poster={destination.heroImage}>
              <source src={destination.heroVideo} type="video/mp4" />
            </video>
          </div>
        </div>
      </section>

      <section className={`${styles.band} ${styles.hotelsBand}`} data-gsap="reveal-section">
        <div className={styles.content}>
          <div className={styles.sectionHeader} data-gsap="section-header">
            <h2>{destination.hotelsTitle[locale]}</h2>
            <p>{destination.hotelsSubtitle[locale]}</p>
          </div>

          <div className={styles.hotelGrid}>
            {hotels.map((hotel, index) => (
              <article
                className={`${styles.hotelCard} ${index === 0 ? styles.featuredHotel : ""}`}
                key={hotel.name}
                data-gsap-item
              >
                <div className={styles.hotelMedia}>
                  <Image
                    src={hotel.image}
                    alt={hotel.name}
                    fill
                    className={styles.hotelImage}
                    sizes="(max-width: 760px) 100vw, (max-width: 1100px) 50vw, 33vw"
                  />
                </div>
                <div className={styles.hotelBody}>
                  <div className={styles.hotelTop}>
                    <div>
                      <h3>{hotel.name}</h3>
                      <p>{hotel.area[locale]}</p>
                    </div>
                    <strong>{hotel.rating.toFixed(1)} ★</strong>
                  </div>
                  <p className={styles.hotelDesc}>{hotel.description[locale]}</p>
                  <p className={styles.hotelPrice}>
                    {copy.from} <em>${hotel.priceFrom}</em> /{copy.perNight}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.band} ${styles.ctaBand}`} data-gsap="reveal-section">
        <div className={styles.content}>
          <div className={styles.ctaPanel} data-gsap-item>
            <div>
              <p className={styles.ctaEyebrow}>{copy.socialProofTitle}</p>
              <h2>{destination.ctaTitle[locale]}</h2>
              <p>{destination.ctaBody[locale]}</p>
            </div>
            <Link href={`/${locale}/results`} className={styles.ctaLink}>
              {destination.ctaLabel[locale]}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
