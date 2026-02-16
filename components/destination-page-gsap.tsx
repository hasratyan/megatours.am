"use client";

import { useEffect } from "react";

export default function DestinationPageGsap() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let reverted = false;
    let revert: (() => void) | undefined;

    (async () => {
      const gsapModule = await import("gsap");
      const scrollTriggerModule = await import("gsap/ScrollTrigger");

      if (reverted) return;

      const gsap = gsapModule.gsap;
      const ScrollTrigger = scrollTriggerModule.ScrollTrigger;
      gsap.registerPlugin(ScrollTrigger);

      const root = document.querySelector<HTMLElement>("[data-destination-page]");
      if (!root) return;

      const context = gsap.context(() => {
        const heroTimeline = gsap.timeline({ defaults: { ease: "power3.out" } });

        heroTimeline
          .from("[data-gsap='hero-kicker']", {
            y: 24,
            autoAlpha: 0,
            duration: 0.55,
          })
          .from(
            "[data-gsap='hero-title']",
            {
              y: 42,
              autoAlpha: 0,
              duration: 0.85,
            },
            "-=0.26"
          )
          .from(
            "[data-gsap='hero-summary']",
            {
              y: 28,
              autoAlpha: 0,
              duration: 0.75,
            },
            "-=0.44"
          )
          .from(
            "[data-gsap='hero-actions']",
            {
              y: 22,
              autoAlpha: 0,
              duration: 0.6,
            },
            "-=0.48"
          )
          .from(
            "[data-gsap='hero-facts']",
            {
              x: 42,
              autoAlpha: 0,
              duration: 0.7,
            },
            "-=0.55"
          );

        gsap.to("[data-gsap='hero-image']", {
          yPercent: 10,
          ease: "none",
          scrollTrigger: {
            trigger: "[data-gsap='hero-band']",
            start: "top top",
            end: "bottom top",
            scrub: true,
          },
        });

        gsap.utils.toArray<HTMLElement>("[data-gsap='reveal-section']").forEach((section) => {
          const header = section.querySelector<HTMLElement>("[data-gsap='section-header']");
          const items = section.querySelectorAll<HTMLElement>("[data-gsap-item]");

          if (header) {
            gsap.from(header, {
              y: 30,
              autoAlpha: 0,
              duration: 0.65,
              ease: "power3.out",
              scrollTrigger: {
                trigger: section,
                start: "top 78%",
              },
            });
          }

          if (items.length > 0) {
            gsap.from(items, {
              y: 34,
              autoAlpha: 0,
              duration: 0.72,
              stagger: 0.08,
              ease: "power3.out",
              scrollTrigger: {
                trigger: section,
                start: "top 74%",
              },
            });
          }
        });
      }, root);

      revert = () => context.revert();
    })();

    return () => {
      reverted = true;
      revert?.();
    };
  }, []);

  return null;
}
