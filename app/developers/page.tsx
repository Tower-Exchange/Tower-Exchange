"use client";

import { useState, useEffect } from "react";
// import { notFound } from "next/navigation";
import { motion } from "framer-motion";
import { Database, Zap, type LucideIcon } from "lucide-react";

type FeatureCard = {
  title: string;
  bullets: string[];
  icon?: LucideIcon;
  iconSrc?: string;
};

const features: FeatureCard[] = [
  {
    icon: Database,
    title: "One Integration. Every Optimal Route.",
    bullets: [
      "Tower aggregates liquidity from multiple DEXs and routing engines into a single API.",
      "Every quote is actively evaluated across available paths, ensuring users receive the most efficient execution with the lowest overall cost.",
    ],
  },
  {
    icon: Zap,
    title: "Performance-Optimized Stablecoin Execution",
    bullets: [
      "Lower slippage and better execution quality through real-time route simulation, liquidity analysis, and dynamic path optimization.",
      "Gasless, seamless user experience with transaction complexity abstracted away, making stablecoin swaps as simple as a single click.",
      "Arc native cross-chain execution with integrated bridging, enabling users to swap and move stablecoins across supported ecosystems without leaving the application.",
    ],
  },
  {
    iconSrc: "/assets/cost_effective icon.svg",
    title: "Cost-Effective Infrastructure With Ecosystem Support",
    bullets: [
      "No subscription fees to access our API, allowing developers to integrate without upfront platform costs.",
      "Co-marketing opportunities for reputable projects, including joint product launches, ecosystem campaigns, community activations, and featured placement across Tower Exchange channels.",
    ],
  },
];

export default function DevelopersPage() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="relative min-h-[calc(100vh-80px)] w-full overflow-hidden bg-background text-foreground pt-6 pb-24 px-4 sm:px-6 lg:px-8 flex flex-col justify-between">
      {/* Background Tower Layer - Anchored to far outer edges of screen with enhanced opacity */}
      <div className="absolute inset-0 w-full h-full pointer-events-none z-0 overflow-hidden">
        {/* Mobile: Centered Single Tower / Desktop: Left Leaning Tower */}
        <div className="absolute left-1/2 -translate-x-[72%] md:translate-x-0 md:left-[-180px] lg:left-[-220px] top-[180px] sm:top-[220px] md:top-[240px] w-[360px] sm:w-[420px] md:w-[480px] lg:w-[560px] max-h-[580px] opacity-75 select-none overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent_100%)]">
          <img
            src="/assets/developer/developer-tower-background.svg"
            alt="Tower Background Left"
            className="w-full h-auto object-contain object-left-top"
          />
        </div>

        {/* Desktop Right Leaning Tower (hidden on mobile) */}
        <div className="hidden md:block absolute right-[-180px] lg:right-[-220px] top-[240px] w-[480px] lg:w-[560px] max-h-[580px] opacity-75 select-none overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent_100%)]">
          <img
            src="/assets/developer/developer-tower-background.svg"
            alt="Tower Background Right"
            className="w-full h-auto object-contain object-right-top scale-x-[-1]"
          />
        </div>

        {/* Ambient Blue Radial Glows matching Figma blur filters */}
        <div className="absolute left-1/2 top-[520px] -translate-x-1/2 w-[600px] h-[350px] bg-primary opacity-15 blur-[140px] rounded-full" />
        <div className="absolute left-1/2 bottom-[40px] -translate-x-1/2 w-[1100px] h-[220px] bg-primary opacity-20 blur-[160px] rounded-full" />
      </div>

      <main className="relative z-10 max-w-[1440px] mx-auto w-full flex-1 flex flex-col items-center">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-4xl mx-auto pt-6 sm:pt-10 px-2 sm:px-4"
        >
          {/* Title - Single Line on Desktop, Wraps on Mobile */}
          <h1 className="text-2xl sm:text-3xl md:text-[44px] font-bold text-foreground tracking-tight leading-tight whitespace-normal md:whitespace-nowrap font-sora">
            Unified Stablecoin Markets on Arc
          </h1>

          {/* Subtitle */}
          <p className="mt-4 sm:mt-5 text-base sm:text-[18px] text-white leading-relaxed font-normal max-w-[700px] mx-auto">
            One integration unlocks the entire Arc stablecoin ecosystem. Access
            the best prices across every liquidity source, eliminate
            fragmentation, and build faster with Tower's unified routing
            infrastructure.
          </p>

          {/* CTA Button */}
          <div className="mt-7">
            <motion.a
              href="https://devs.tower.exchange"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              className="bg-primary hover:bg-[#67a7fa] text-[#0C0C0D] font-semibold text-sm sm:text-[15px] w-[209px] h-[36px] rounded-full shadow-md transition-colors cursor-pointer inline-flex items-center justify-center"
            >
              Start your Integration
            </motion.a>
          </div>
        </motion.div>

        {/* Protocol Logos Marquee */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="relative w-full max-w-[900px] mx-auto my-12 sm:my-14 overflow-hidden flex items-center min-h-[44px] h-auto"
          style={
            isMobile
              ? {}
              : {
                  maskImage:
                    "linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.75) 20%, rgba(255,255,255,0.75) 80%, rgba(255,255,255,0) 100%)",
                  WebkitMaskImage:
                    "linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.75) 20%, rgba(255,255,255,0.75) 80%, rgba(255,255,255,0) 100%)",
                }
          }
        >
          <motion.div
            className="flex w-max"
            animate={{ x: ["0%", "-50%"] }}
            transition={{
              ease: "linear",
              duration: 30,
              repeat: Infinity,
            }}
          >
            {[...Array(2)].map((_, i) => (
              <div
                key={i}
                className="flex gap-12 sm:gap-16 md:gap-24 items-center shrink-0 pr-12 sm:pr-16 md:pr-24"
              >
                {/* Circle Logo */}
                <div
                  className="h-7 sm:h-8 w-[110px] sm:w-[130px] md:w-[150px] bg-gradient-to-b from-[#F3F4F6] via-[#9CA3AF] to-[#4B5563] hover:from-white hover:to-gray-300 transition-all cursor-pointer opacity-90 hover:opacity-100 shrink-0"
                  style={{
                    maskImage: `url('/assets/developer/developer-circle.svg')`,
                    WebkitMaskImage: `url('/assets/developer/developer-circle.svg')`,
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskSize: "contain",
                    WebkitMaskSize: "contain",
                    maskPosition: "center",
                    WebkitMaskPosition: "center",
                  }}
                />

                {/* Arc Logo */}
                <div
                  className="h-7 sm:h-8 w-[70px] sm:w-[85px] md:w-[100px] bg-gradient-to-b from-[#F3F4F6] via-[#9CA3AF] to-[#4B5563] hover:from-white hover:to-gray-300 transition-all cursor-pointer opacity-90 hover:opacity-100 shrink-0"
                  style={{
                    maskImage: `url('/assets/developer/developer-arc.svg')`,
                    WebkitMaskImage: `url('/assets/developer/developer-arc.svg')`,
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskSize: "contain",
                    WebkitMaskSize: "contain",
                    maskPosition: "center",
                    WebkitMaskPosition: "center",
                  }}
                />

                {/* Gate DEX Logo */}
                <div
                  className="h-7 sm:h-8 w-[130px] sm:w-[160px] md:w-[185px] bg-gradient-to-b from-[#F3F4F6] via-[#9CA3AF] to-[#4B5563] hover:from-white hover:to-gray-300 transition-all cursor-pointer opacity-90 hover:opacity-100 shrink-0"
                  style={{
                    maskImage: `url('/assets/developer/developer-gate-dex.svg')`,
                    WebkitMaskImage: `url('/assets/developer/developer-gate-dex.svg')`,
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskSize: "contain",
                    WebkitMaskSize: "contain",
                    maskPosition: "center",
                    WebkitMaskPosition: "center",
                  }}
                />

                {/* Hibachi Logo */}
                <div
                  className="h-7 sm:h-8 w-[120px] sm:w-[140px] md:w-[170px] bg-gradient-to-b from-[#F3F4F6] via-[#9CA3AF] to-[#4B5563] hover:from-white hover:to-gray-300 transition-all cursor-pointer opacity-90 hover:opacity-100 shrink-0"
                  style={{
                    maskImage: `url('/assets/developer/developer-hibachi.svg')`,
                    WebkitMaskImage: `url('/assets/developer/developer-hibachi.svg')`,
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskSize: "contain",
                    WebkitMaskSize: "contain",
                    maskPosition: "center",
                    WebkitMaskPosition: "center",
                  }}
                />

                {/* Bitget Logo */}
                <div
                  className="h-7 sm:h-8 w-[120px] sm:w-[140px] md:w-[170px] bg-gradient-to-b from-[#F3F4F6] via-[#9CA3AF] to-[#4B5563] hover:from-white hover:to-gray-300 transition-all cursor-pointer opacity-90 hover:opacity-100 shrink-0"
                  style={{
                    maskImage: `url('/assets/developer/developer-bitget.svg')`,
                    WebkitMaskImage: `url('/assets/developer/developer-bitget.svg')`,
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskSize: "contain",
                    WebkitMaskSize: "contain",
                    maskPosition: "center",
                    WebkitMaskPosition: "center",
                  }}
                />
              </div>
            ))}
          </motion.div>
        </motion.div>

        {/* Feature Cards Stack (Figma: width 1011px, rx 25.4px, fill #191A1C, border #26282D, gap 34px) */}
        <div className="w-full max-w-[1011px] space-y-[34px]">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 25 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 + index * 0.1 }}
                className="bg-[#14181f] border border-[#272c35] rounded-[25px] p-6 sm:p-8 shadow-xl"
              >
                {/* Header section with #7BB8FF icon */}
                <div className="flex items-center gap-3">
                  {feature.iconSrc ? (
                    <img
                      src={feature.iconSrc}
                      alt=""
                      aria-hidden
                      className="h-[22px] w-[22px] shrink-0"
                    />
                  ) : Icon ? (
                    <Icon className="w-5.5 h-5.5 text-primary shrink-0" />
                  ) : null}
                  <h2 className="text-lg sm:text-xl font-bold text-foreground tracking-tight">
                    {feature.title}
                  </h2>
                </div>

                {/* Thin divider line */}
                <div className="w-full h-[1px] bg-[#2A2D35] my-4 sm:my-5" />

                {/* Bullet List */}
                <ul className="space-y-3.5 text-sm sm:text-base text-muted-foreground font-normal leading-relaxed">
                  {feature.bullets.map((bullet, bIndex) => (
                    <li key={bIndex} className="flex items-start gap-2.5">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#7BB8FF]" />
                      <span className="text-white font-light">{bullet}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
