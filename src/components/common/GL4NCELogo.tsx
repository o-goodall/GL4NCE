import { useId } from "react";

type LogoVariant = "light" | "dark" | "icon" | "auth";

interface VariantConfig {
  w: number;
  h: number;
  box: number;
  rx: number;
  textX: number;
  textY: number;
  fontSize: number;
  textColor: string;
  fourColor: string;
}

const VARIANTS: Record<LogoVariant, VariantConfig> = {
  light: { w: 150, h: 40,  box: 40, rx: 10,   textX: 48, textY: 27,   fontSize: 21, textColor: "#101828", fourColor: "#465FFF" },
  dark:  { w: 130, h: 32,  box: 32, rx: 8.4,  textX: 41, textY: 22.5, fontSize: 19, textColor: "#ffffff", fourColor: "#9CB9FF" },
  icon:  { w: 32,  h: 32,  box: 32, rx: 8.4,  textX: 0,  textY: 0,    fontSize: 0,  textColor: "",        fourColor: "" },
  auth:  { w: 195, h: 48,  box: 48, rx: 12.6, textX: 62, textY: 34,   fontSize: 29, textColor: "#ffffff", fourColor: "#9CB9FF" },
};

interface GL4NCELogoProps {
  variant?: LogoVariant;
  className?: string;
}

export default function GL4NCELogo({ variant = "light", className }: GL4NCELogoProps) {
  const rawId = useId();
  // useId returns strings like ":r0:" — strip non-alphanumeric so they're valid CSS identifiers
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, "_");

  const v = VARIANTS[variant];
  const s = v.box / 40; // scale factor relative to base 40×40 eye design
  const cx = v.box / 2;
  const cy = v.box / 2;

  // Eye path — almond/vesica shape (base coords for 40×40, scaled by s)
  const sclera = [
    `M${8 * s} ${cy}`,
    `Q${14 * s} ${11 * s} ${cx} ${11 * s}`,
    `Q${26 * s} ${11 * s} ${32 * s} ${cy}`,
    `Q${26 * s} ${29 * s} ${cx} ${29 * s}`,
    `Q${14 * s} ${29 * s} ${8 * s} ${cy}Z`,
  ].join(" ");

  const irisR  = 6.5 * s;
  const pupilR = 3.0 * s;

  // Glimmer ellipse — sits in upper-left iris quadrant
  const glimCx = cx - 2.5 * s;
  const glimCy = cy - 3.0 * s;

  // Main specular catchlight
  const cl1cx = cx - 1.8 * s;
  const cl1cy = cy - 2.2 * s;

  // Secondary small catchlight
  const cl2cx = cx + 2.0 * s;
  const cl2cy = cy + 1.5 * s;

  // Unique IDs for this instance
  const irisId    = `ig_${uid}`;
  const shimId    = `sg_${uid}`;
  const foilId    = `fg_${uid}`;
  const shadowId  = `sh_${uid}`;
  const glowId    = `gw_${uid}`;
  const clipId    = `cl_${uid}`;

  // CSS animation names (must be valid identifiers)
  const animGlimmer = `glimmer_${uid}`;
  const animPulse   = `pulse_${uid}`;
  const animCatch   = `catch_${uid}`;

  const css = `
    @keyframes ${animGlimmer} {
      0%   { opacity: 0; }
      20%  { opacity: 0; }
      45%  { opacity: 0.88; }
      60%  { opacity: 0.88; }
      80%  { opacity: 0; }
      100% { opacity: 0; }
    }
    @keyframes ${animPulse} {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.85; }
    }
    @keyframes ${animCatch} {
      0%, 100% { opacity: 0.9; }
      35%      { opacity: 0.45; }
      65%      { opacity: 1; }
    }
    .glimmer-${uid} { animation: ${animGlimmer} 4.2s ease-in-out infinite; }
    .iris-${uid}    { animation: ${animPulse}   3.8s ease-in-out infinite; }
    .catch1-${uid}  { animation: ${animCatch}   5.1s ease-in-out infinite 0.6s; }
  `;

  return (
    <svg
      width={v.w}
      height={v.h}
      viewBox={`0 0 ${v.w} ${v.h}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="GL4NCE"
      role="img"
    >
      <defs>
        {/* Blue iris — deep centre to bright edge */}
        <radialGradient id={irisId} cx="50%" cy="45%" r="55%" fx="40%" fy="35%">
          <stop offset="0%"   stopColor="#c2d6ff" />
          <stop offset="35%"  stopColor="#7592ff" />
          <stop offset="70%"  stopColor="#3641f5" />
          <stop offset="100%" stopColor="#1a1f6e" />
        </radialGradient>

        {/* Shimmer/glimmer highlight */}
        <radialGradient id={shimId} cx="35%" cy="30%" r="65%">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="50%"  stopColor="#c2d6ff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#465FFF" stopOpacity="0" />
        </radialGradient>

        {/* Icon box highlight overlay */}
        <linearGradient id={foilId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#7592ff" stopOpacity="0.6" />
          <stop offset="50%"  stopColor="#465FFF" stopOpacity="0" />
          <stop offset="100%" stopColor="#2a31d8" stopOpacity="0.4" />
        </linearGradient>

        {/* Box drop-shadow */}
        <filter id={shadowId} x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="1" stdDeviation="1" floodOpacity="0.15" />
        </filter>

        {/* Subtle glow around the eye */}
        <filter id={glowId} x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="0.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>

        {/* Clip glimmer ellipse to iris boundary */}
        <clipPath id={clipId}>
          <circle cx={cx} cy={cy} r={irisR} />
        </clipPath>

        <style>{css}</style>
      </defs>

      {/* ── Icon box ─────────────────────────────────────── */}
      <rect width={v.box} height={v.box} rx={v.rx} ry={v.rx} fill="#465FFF" filter={`url(#${shadowId})`} />
      <rect width={v.box} height={v.box} rx={v.rx} ry={v.rx} fill={`url(#${foilId})`} />

      {/* ── Animated eye ─────────────────────────────────── */}
      <g filter={`url(#${glowId})`}>
        {/* Sclera — almond / vesica shape */}
        <path d={sclera} fill="white" fillOpacity="0.95" />

        {/* Iris */}
        <circle
          className={`iris-${uid}`}
          cx={cx} cy={cy} r={irisR}
          fill={`url(#${irisId})`}
        />

        {/* Pupil */}
        <circle cx={cx} cy={cy} r={pupilR} fill="#05071a" />

        {/* Glimmer sweep (animated opacity) */}
        <ellipse
          className={`glimmer-${uid}`}
          cx={glimCx}
          cy={glimCy}
          rx={2.5 * s}
          ry={1.5 * s}
          fill={`url(#${shimId})`}
          clipPath={`url(#${clipId})`}
          transform={`rotate(-15 ${glimCx} ${glimCy})`}
        />

        {/* Main specular catchlight */}
        <ellipse
          className={`catch1-${uid}`}
          cx={cl1cx} cy={cl1cy}
          rx={1.3 * s} ry={s}
          fill="white"
          fillOpacity="0.9"
          transform={`rotate(-10 ${cl1cx} ${cl1cy})`}
        />

        {/* Secondary catchlight */}
        <ellipse
          cx={cl2cx} cy={cl2cy}
          rx={0.6 * s} ry={0.45 * s}
          fill="white"
          fillOpacity="0.5"
        />
      </g>

      {/* ── Wordmark ─────────────────────────────────────── */}
      {variant !== "icon" && (
        <text
          x={v.textX}
          y={v.textY}
          fontFamily="Outfit, 'Helvetica Neue', Arial, sans-serif"
          fontWeight="700"
          fontSize={v.fontSize}
          fill={v.textColor}
        >
          GL<tspan fill={v.fourColor}>4</tspan>NCE
        </text>
      )}
    </svg>
  );
}
