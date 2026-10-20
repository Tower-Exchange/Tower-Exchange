"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";

export default function PromotionalSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(false);
  const [active, setActive] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const [isDismissing, setIsDismissing] = useState(false);
  const [dismissedSlides, setDismissedSlides] = useState<string[]>([]);

  const slides = [
  //  {
  //     id: "qcad-trade",
  //     heroImage: "/assets/promotional-card-qcad.svg",
  //     imageWidthClass: "w-[100px]",
  //     title: "Trade $QCAD on Tower",
  //     description: "QCAD, Stablecorp’s Canadian Dollar stablecoin backed 1:1 by real CAD, is now available for trading on Tower.",
  //     ctaText: "Trade QCAD",
  //     action: () => {
  //       const dispatch = () => {
  //         const event = new CustomEvent("select-sell-token", { detail: { symbol: "QCAD" } });
  //         window.dispatchEvent(event);
  //       };
  //       dispatch();
  //       router.push("/?select=QCAD");
  //       setTimeout(dispatch, 50);
  //     }
  //   },
    // {
    //   id: "cngn-trade",
    //   heroImage: "/assets/promotional-card-cngn.svg",
    //   imageWidthClass: "w-[100px]",
    //   title: "Trade $cNGN on Tower",
    //   description: "$cNGN, the Compliant Naira stablecoin backed 1:1 by real NGN, is now available for trading on Tower.",
    //   ctaText: "Trade $cNGN",
    //   action: () => {
    //     const dispatch = () => {
    //       const event = new CustomEvent("select-sell-token", { detail: { symbol: "cNGN" } });
    //       window.dispatchEvent(event);
    //     };
    //     dispatch();
    //     router.push("/?select=cNGN");
    //     setTimeout(dispatch, 50);
    //   }
    // },
    // {
    //   id: "dev-page",
    //   heroImage: "/assets/dev-page.svg",
    //   imageWidthClass: "w-[125px]",
    //   title: "Build with Tower Console",
    //   description: "You can now integrate Tower’s routing infrastructure directly into your apps and build.",
    //   ctaText: "Get Started",
    //   action: () => {
    //     window.open("https://devs.tower.exchange", "_blank", "noopener,noreferrer");
    //   }
    // },
    // {
    //   id: "bridge-solana",
    //   heroImage: "/assets/promotional-card-bridge.svg",
    //   imageWidthClass: "w-[125px]",
    //   title: "Bridge to Solana Devnet",
    //   description: "You can now seamlessly bridge your assets directly to third-party wallets on Solana Devnet.",
    //   ctaText: "Try it Now",
    //   action: () => {
    //     router.push("/bridge?fromChain=arc-testnet&fromToken=USDC&toChain=solana&toToken=USDC");
    //   }
    // },
    // {
    //   id: "cirbtc-trade",
    //   heroImage: "/assets/TradecircBTC.svg",
    //   imageWidthClass: "w-[100px]",
    //   title: "Trade $cirBTC on Tower",
    //   description: "cirBTC, Circle's wrapped Bitcoin backed 1:1 by real BTC, is now available for trading on Tower.",
    //   ctaText: "Trade cirBTC",
    //   action: () => {
    //     router.push("/?select=cirBTC");
    //     setTimeout(() => {
    //       const event = new CustomEvent("select-sell-token", { detail: { symbol: "cirBTC" } });
    //       window.dispatchEvent(event);
    //     }, 50);
    //   }
    // },
    {
      id: "conquest-trade",
      heroImage: "/assets/tradeonclaude.svg",
      imageWidthClass: "w-[125px]",
      title: "Trade on Claude AI",
      description: "Connect Tower’s MCP to your personal AI agent and start trading stablecoins seamlessly.",
      ctaText: "Try it Now",
      action: () => {
        window.open("https://docs.tower.exchange/mcp", "_blank", "noopener,noreferrer");
      }
    },
    {
      id: "conquest-trade",
      heroImage: "/assets/conquests.svg",
      imageWidthClass: "w-[125px]",
      title: "Introducing Conquests",
      description: "Earn Republic Valor Points for participating in the campaign and completing eligible tasks.",
      ctaText: "Earn Points",
      action: () => {
        window.open("https://republic.legion.cc/conquest/1467135771780710474-tower-exchange-pioneers", "_blank", "noopener,noreferrer");
      }
    },
    {
      id: "arctober-badges",
      heroImage: "/assets/arctober.svg",
      imageWidthClass: "w-[125px]",
      title: "Introducing Arctober Badges",
      description: "To celebrate the Arc mainnet era we are introducing two new badges. The requirements and perks has been revealed.",
      ctaText: "Claim your Badges",
      action: () => {
        router.push("/profile?tab=badges");
      }
    }
    // {
    //   id: "cirbtc-dca",
    //   heroImage: "/assets/DCAwithcirBTC.svg",
    //   imageWidthClass: "w-[125px]",
    //   title: "DCA with $cirBTC",
    //   description: "You can now automate $cirBTC purchases with Recurring Orders on Tower.",
    //   ctaText: "Try it Now",
    //   action: () => {
    //     router.push("/recurring-orders?tab=create-buy&payToken=cirBTC");
    //   }
    // }
  ];

  const visibleSlides = slides.filter((slide) => !dismissedSlides.includes(slide.id));

  useEffect(() => {
    // Check if the user has already dismissed this promotion
    const legacyDismissed = localStorage.getItem("tower-cirbtc-promo-dismissed") === "true";
    if (legacyDismissed) {
      setDismissedSlides(slides.map((s) => s.id));
      return;
    }

    const dismissed: string[] = [];
    slides.forEach((slide) => {
      if (localStorage.getItem(`tower-promo-dismissed-${slide.id}`) === "true") {
        dismissed.push(slide.id);
      }
    });
    setDismissedSlides(dismissed);

    const allDismissed = slides.every((slide) => dismissed.includes(slide.id));
    if (!allDismissed) {
      setIsVisible(true);
      // Trigger the slide-in and fade-in transition after the element mounts
      const timer = setTimeout(() => {
        setActive(true);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, []);

  // Autoplay slideshow: changes slide every 5 seconds.
  // Re-creating the interval when activeSlide/isVisible changes resets the 5s timer upon manual interaction.
  useEffect(() => {
    if (!isVisible || isDismissing || visibleSlides.length <= 1) return;
    const interval = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % visibleSlides.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [isVisible, isDismissing, activeSlide, visibleSlides.length]);

  // Adjust active slide if it's out of bounds
  useEffect(() => {
    if (activeSlide >= visibleSlides.length && visibleSlides.length > 0) {
      setActiveSlide(visibleSlides.length - 1);
    }
  }, [activeSlide, visibleSlides.length]);

  const handleCloseSlide = (slideId: string) => {
    const remainingSlides = slides.filter(
      (slide) => !dismissedSlides.includes(slide.id) && slide.id !== slideId
    );

    if (remainingSlides.length === 0) {
      // Last slide closed: trigger whole-sidebar dismissal animation
      setActive(false);
      setIsDismissing(true);
      setTimeout(() => {
        setIsVisible(false);
        setDismissedSlides((prev) => {
          const next = [...prev, slideId];
          localStorage.setItem(`tower-promo-dismissed-${slideId}`, "true");
          return next;
        });
      }, 300);
    } else {
      // Just close this slide, update active slide if needed
      setDismissedSlides((prev) => {
        const next = [...prev, slideId];
        localStorage.setItem(`tower-promo-dismissed-${slideId}`, "true");
        return next;
      });

      const currentVisible = slides.filter((slide) => !dismissedSlides.includes(slide.id));
      const dismissedIndexInVisible = currentVisible.findIndex((s) => s.id === slideId);

      if (activeSlide >= remainingSlides.length) {
        setActiveSlide(remainingSlides.length - 1);
      } else if (activeSlide === dismissedIndexInVisible) {
        if (activeSlide > 0) {
          setActiveSlide(activeSlide - 1);
        }
      }
    }
  };

  const isTradePage = pathname === "/" || pathname === "/swap" || pathname === "/bridge";

  if (!isVisible || !isTradePage || visibleSlides.length === 0) return null;

  // Build CSS classes dynamically for the outer fixed positioning wrapper
  const outerWrapperClasses = [
    "promotional-sidebar",
    // Base/Mobile/Tablet layout: Inline/relative layout positioned below main page content
    "relative w-full max-w-md mx-auto z-20 p-4 flex flex-col font-inter transition-all duration-300 ease-out select-none",
    
    // Desktop layout: fixed on the bottom-right, 301px wide, floating above the footer
    "xl:fixed xl:bottom-24 xl:top-auto xl:right-6 xl:left-auto xl:w-[301px] xl:p-0 xl:max-w-none xl:mx-0",
    
    // Animation/Transition states for mount and dismiss
    active
      ? "opacity-100 translate-y-0 xl:translate-x-0"
      : "opacity-0 translate-y-4 xl:translate-x-5 max-xl:translate-y-full"
  ].join(" ");

  const cardStyle = undefined;

  return (
    <div
      className={outerWrapperClasses}
      role="complementary"
      aria-label="cirBTC Promotions"
    >
      {/* Cards Viewport: masks the horizontal sliding wrapper */}
      <div className="relative w-full overflow-hidden rounded-2xl">
        
        {/* Sliding wrapper: moves the entire cards side by side */}
        <div
          className="flex transition-transform duration-1000 ease-in-out"
          style={{ transform: `translateX(-${activeSlide * 100}%)` }}
        >
          {visibleSlides.map((slide) => (
            <div
              key={slide.id}
              className="relative w-full bg-card border border-border flex flex-col p-3 xl:p-4 rounded-2xl shrink-0 cursor-pointer shadow-[0_8px_24px_rgba(15,23,42,0.08)] light:shadow-[0_8px_24px_rgba(15,23,42,0.06)] dark:shadow-[0_10px_35px_rgba(0,0,0,0.35)]"
              onClick={() => {
                slide.action();
                if (window.innerWidth < 1280) {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
            >
              {/* Close Button - positioned absolutely to avoid flex flow disruption */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseSlide(slide.id);
                }}
                className="absolute top-2.5 right-2.5 xl:top-3.5 xl:right-3.5 w-[30px] h-[30px] inline-flex items-center justify-center rounded-full border border-border bg-secondary/80 p-0 text-muted-foreground transition-colors hover:text-foreground hover:bg-accent xl:hover:bg-accent z-10"
                aria-label="Close promotion"
              >
                <X size={16} />
              </button>

              {/* Top Section: Horizontal on Mobile, Vertical on Desktop */}
              <div className="flex flex-row xl:flex-col gap-3 xl:gap-0 items-start xl:items-stretch w-full">
                
                {/* Hero Image Container */}
                <div className={`h-[80px] w-[80px] sm:h-[90px] sm:w-[90px] shrink-0 xl:w-full xl:h-[140px]`}>
                  <img
                    src={slide.heroImage}
                    alt={slide.title}
                    className="w-full h-full object-cover rounded-lg border border-border xl:rounded-xl"
                  />
                </div>
                
                {/* Content text */}
                <div className="flex flex-col justify-center gap-y-1 xl:gap-y-2 min-w-0 flex-1 xl:pt-4 pr-7 xl:pr-0">
                  <h3 className="font-inter font-semibold text-[16px] xl:text-[18px] leading-tight text-foreground m-0 tracking-tight">
                    {slide.title}
                  </h3>
                  <p className="font-inter text-[13px] xl:text-[14px] leading-[1.3] text-muted-foreground m-0 font-light whitespace-pre-line">
                    {slide.description}
                  </p>
                </div>
              </div>
              
              {/* Shared CTA Button (Sits at the bottom on both Mobile and Desktop) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  slide.action();
                  if (window.innerWidth < 1280) {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }
                }}
                className="flex w-full h-10 mt-3 xl:mt-4 rounded-full bg-primary hover:bg-primary/90 text-[#0C0C0D] font-inter font-semibold text-base items-center justify-center border-none transition-all duration-200 ease-in-out hover:-translate-y-[2px] active:translate-y-0 active:scale-[0.98] shadow-md shrink-0"
              >
                {slide.ctaText}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Slide Indicators: positioned below and outside the card container */}
      {visibleSlides.length > 1 && (
        <div className="flex justify-end gap-1.5 mt-2 px-1">
          {visibleSlides.map((_, index) => (
            <button
              key={index}
              onClick={() => setActiveSlide(index)}
              className={`h-[5px] rounded-full transition-all duration-300 focus:outline-none cursor-pointer ${
                activeSlide === index ? "bg-primary w-[28px]" : "bg-muted-foreground/25 w-[14px] hover:bg-muted-foreground/40"
              }`}
              aria-label={`Go to Slide ${index + 1}`}
              style={{ border: "none" }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
