import { useId } from "react";

type LogoVariant = "light" | "dark" | "icon" | "auth";

interface GL4NCELogoProps {
  variant?: LogoVariant;
  className?: string;
}

// Per-variant layout config
const CFGS = {
  //                   totalW  totalH  box   rx    textX  textY  fontSize  textColor    fourColor
  light: { totalW: 150, totalH: 40,  box: 40, rx: 10,   textX: 48, textY: 26.5, fontSize: 21, textColor: "#101828", fourColor: "#465FFF" },
  dark:  { totalW: 130, totalH: 32,  box: 32, rx: 8,    textX: 41, textY: 21.5, fontSize: 19, textColor: "#ffffff",  fourColor: "#9CB9FF" },
  icon:  { totalW: 32,  totalH: 32,  box: 32, rx: 8,    textX: 0,  textY: 0,    fontSize: 0,  textColor: "",         fourColor: "" },
  auth:  { totalW: 195, totalH: 48,  box: 48, rx: 12,   textX: 62, textY: 33.5, fontSize: 28, textColor: "#ffffff",  fourColor: "#9CB9FF" },
} as const;

export default function GL4NCELogo({ variant = "light", className }: GL4NCELogoProps) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, "_");

  const cfg = CFGS[variant];
  const b   = cfg.box;

  // Spoke padding constants (as fraction of box size)
  const SPOKE_INNER_PADDING = 0.015; // gap between pupil edge and spoke start
  const SPOKE_OUTER_PADDING = 0.010; // inset from iris edge to spoke end
  // Vertical baseline offset for the "4" label inside the icon iris
  const ICON_TEXT_BASELINE_OFFSET = 0.052;

  // ── Eye geometry (all proportional to box size) ─────────────────────────
  const ecx  = b * 0.5;         // eye centre x
  const ecy  = b * 0.5;         // eye centre y
  const lx   = b * 0.08;        // left  tip  x  (≈ 3.2 @ 40)
  const rx   = b * 0.92;        // right tip  x  (≈ 36.8 @ 40)
  const yExt = b * 0.165;       // half eye height (≈ 6.6 @ 40)
  const ty2  = ecy - yExt;      // top of eye
  const by2  = ecy + yExt;      // bottom of eye
  const cpIn = b * 0.24;        // inner bezier CP x  (near tips)
  const cpOt = b * 0.76;        // outer bezier CP x

  // Almond eye path — cubic bezier, wide + natural corners
  const eyePath  = `M${lx},${ecy} C${cpIn},${ty2} ${cpOt},${ty2} ${rx},${ecy} C${cpOt},${by2} ${cpIn},${by2} ${lx},${ecy}Z`;
  // Upper lid arc only (for inner highlight)
  const upperArc = `M${lx},${ecy} C${cpIn},${ty2} ${cpOt},${ty2} ${rx},${ecy}`;

  const irisR  = b * 0.133;     // iris   radius (≈ 5.32 @ 40)
  const pupilR = b * 0.058;     // pupil  radius (≈ 2.32 @ 40)
  const dotR   = b * 0.036;     // corner dot radius

  // ── Iris spokes — 12 radial lines, will rotate slowly ───────────────────
  const N_SPOKES = 12;
  const spokes = Array.from({ length: N_SPOKES }, (_, i) => {
    const a      = (i / N_SPOKES) * Math.PI * 2;
    const innerR = pupilR + b * SPOKE_INNER_PADDING;
    const outerR = irisR  - b * SPOKE_OUTER_PADDING;
    return {
      x1: ecx + innerR * Math.cos(a),
      y1: ecy + innerR * Math.sin(a),
      x2: ecx + outerR * Math.cos(a),
      y2: ecy + outerR * Math.sin(a),
    };
  });

  // ── Glimmer + catchlight positions ─────────────────────────────────────
  const glCx = ecx - irisR * 0.3;
  const glCy = ecy - irisR * 0.44;
  const cl1x = ecx - irisR * 0.33;
  const cl1y = ecy - irisR * 0.4;

  // ── SVG def IDs (unique per instance) ──────────────────────────────────
  const bgId     = `bg_${uid}`;
  const glowId   = `gl_${uid}`;
  const boxShId  = `bs_${uid}`;
  const irisClId = `ic_${uid}`;
  const eyeClId  = `ec_${uid}`;

  // ── CSS animation names ─────────────────────────────────────────────────
  const aBlink   = `blink_${uid}`;
  const aOutline = `outln_${uid}`;
  const aGlimmer = `glimr_${uid}`;
  const aSpokes  = `spk_${uid}`;
  const aCatch   = `ctch_${uid}`;

  const css = `
    /* Blink: eye group squishes to 7% height then springs back */
    @keyframes ${aBlink} {
      0%, 88%, 100% { transform: scaleY(1); }
      92%  { transform: scaleY(0.07); }
      95%  { transform: scaleY(1.04); }
      98%  { transform: scaleY(1); }
    }
    /* Outline glow pulse */
    @keyframes ${aOutline} {
      0%, 100% { opacity: 0.72; }
      50%      { opacity: 1;    }
    }
    /* Glimmer — sweeps in, holds, fades */
    @keyframes ${aGlimmer} {
      0%, 16%   { opacity: 0;    }
      35%, 55%  { opacity: 0.88; }
      72%, 100% { opacity: 0;    }
    }
    /* Iris spokes — slow continuous rotation */
    @keyframes ${aSpokes} {
      from { transform: rotate(0deg);   }
      to   { transform: rotate(360deg); }
    }
    /* Catchlight shimmer */
    @keyframes ${aCatch} {
      0%, 100% { opacity: 0.9;  }
      42%      { opacity: 0.3;  }
      72%      { opacity: 1;    }
    }
    .eye-g-${uid} {
      transform-box: fill-box;
      transform-origin: center;
      animation: ${aBlink} 6s ease-in-out infinite 2s;
    }
    .outline-${uid} { animation: ${aOutline} 3.2s ease-in-out infinite; }
    .glimmer-${uid} { animation: ${aGlimmer} 5s   ease-in-out infinite 1s; }
    .spokes-g-${uid} {
      transform-box: fill-box;
      transform-origin: center;
      animation: ${aSpokes} 24s linear infinite;
    }
    .catch-${uid} { animation: ${aCatch} 5.5s ease-in-out infinite 1.5s; }
    @media (prefers-reduced-motion: reduce) {
      .eye-g-${uid}, .outline-${uid}, .glimmer-${uid},
      .spokes-g-${uid}, .catch-${uid} { animation: none; }
    }
  `;

  return (
    <svg
      width={cfg.totalW}
      height={cfg.totalH}
      viewBox={`0 0 ${cfg.totalW} ${cfg.totalH}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="GL4NCE"
      role="img"
    >
      <defs>
        {/* Box background — deep navy, lit from top-left */}
        <linearGradient id={bgId} x1="0" y1="0" x2={b} y2={b} gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#1c2260" />
          <stop offset="100%" stopColor="#060920" />
        </linearGradient>

        {/* Glowing outline filter — double-layer blue halo */}
        <filter id={glowId} x="-40%" y="-80%" width="180%" height="260%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.4" result="b1" />
          <feFlood floodColor="#465FFF" floodOpacity="0.65" result="c1" />
          <feComposite in="c1" in2="b1" operator="in" result="glow1" />
          <feGaussianBlur in="SourceAlpha" stdDeviation="0.45" result="b2" />
          <feFlood floodColor="#c2d6ff" floodOpacity="0.5" result="c2" />
          <feComposite in="c2" in2="b2" operator="in" result="glow2" />
          <feMerge>
            <feMergeNode in="glow1" />
            <feMergeNode in="glow1" />
            <feMergeNode in="glow2" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Box drop shadow — blue-tinted glow */}
        <filter id={boxShId} x="-5%" y="-5%" width="110%" height="120%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#465FFF" floodOpacity="0.28" />
        </filter>

        {/* Clip eye content to iris circle */}
        <clipPath id={irisClId}>
          <circle cx={ecx} cy={ecy} r={irisR} />
        </clipPath>

        {/* Clip iris/pupil to eye almond boundary */}
        <clipPath id={eyeClId}>
          <path d={eyePath} />
        </clipPath>

        <style>{css}</style>
      </defs>

      {/* ── Box: dark atmospheric navy ───────────────────────────────────── */}
      <rect
        width={b} height={b} rx={cfg.rx} ry={cfg.rx}
        fill={`url(#${bgId})`}
        filter={`url(#${boxShId})`}
      />

      {/* ── Eye — entire group blinks via scaleY ────────────────────────── */}
      <g className={`eye-g-${uid}`}>

        {/* Dark sclera — moody, near-black (like #040201 in situation-monitor) */}
        <path d={eyePath} fill="#050b22" />

        {/* Iris — ring-stroke style: transparent fill, bright stroke ring.
            Exactly as in situation-monitor: you see the dark sclera through it */}
        <circle
          cx={ecx} cy={ecy} r={irisR}
          fill="rgba(70,95,255,0.1)"
          stroke="#465FFF"
          strokeOpacity="0.82"
          strokeWidth={b * 0.022}
          clipPath={`url(#${eyeClId})`}
        />

        {/* Iris spokes — 12 radial ciliary lines, rotating slowly */}
        <g className={`spokes-g-${uid}`} clipPath={`url(#${irisClId})`}>
          {spokes.map((sp, i) => (
            <line
              key={i}
              x1={sp.x1} y1={sp.y1}
              x2={sp.x2} y2={sp.y2}
              stroke="#7592ff"
              strokeOpacity="0.22"
              strokeWidth={b * 0.012}
            />
          ))}
        </g>

        {/* Inner limbal accent ring */}
        <circle
          cx={ecx} cy={ecy} r={irisR * 0.8}
          fill="none"
          stroke="#9CB9FF"
          strokeOpacity="0.13"
          strokeWidth={b * 0.01}
          clipPath={`url(#${eyeClId})`}
        />

        {/* Pupil — deep dark with faint blue ring */}
        <circle
          cx={ecx} cy={ecy} r={pupilR}
          fill="#030510"
          stroke="#465FFF"
          strokeOpacity="0.32"
          strokeWidth={b * 0.012}
        />

        {/* Glimmer — animated sweep across upper-left iris */}
        <ellipse
          className={`glimmer-${uid}`}
          cx={glCx} cy={glCy}
          rx={irisR * 0.52} ry={irisR * 0.28}
          fill="rgba(194,214,255,0.52)"
          transform={`rotate(-18 ${glCx} ${glCy})`}
          clipPath={`url(#${irisClId})`}
        />

        {/* Main specular catchlight */}
        <ellipse
          className={`catch-${uid}`}
          cx={cl1x} cy={cl1y}
          rx={irisR * 0.2} ry={irisR * 0.13}
          fill="white" fillOpacity="0.9"
          transform={`rotate(-14 ${cl1x} ${cl1y})`}
        />

        {/* Secondary small catchlight */}
        <ellipse
          cx={ecx + irisR * 0.33} cy={ecy + irisR * 0.3}
          rx={irisR * 0.09}       ry={irisR * 0.065}
          fill="white" fillOpacity="0.38"
        />

        {/* Glowing outline — the soul of the design.
            Pulsing blue halo that makes the eye feel alive. */}
        <path
          className={`outline-${uid}`}
          d={eyePath}
          fill="none"
          stroke="#465FFF"
          strokeOpacity="0.9"
          strokeWidth={b * 0.025}
          filter={`url(#${glowId})`}
        />

        {/* Upper lid subtle highlight arc */}
        <path
          d={upperArc}
          fill="none"
          stroke="#c2d6ff"
          strokeOpacity="0.28"
          strokeWidth={b * 0.009}
          strokeLinecap="round"
        />

        {/* Corner accent dots — signature element from situation-monitor */}
        <circle cx={lx} cy={ecy} r={dotR} fill="#7592ff" fillOpacity="0.75" />
        <circle cx={rx} cy={ecy} r={dotR} fill="#7592ff" fillOpacity="0.75" />

        {/* Icon variant only: "4" centered in the iris — the brand digit
            embedded in the eye, overlaying sclera like the welcome screen */}
        {variant === "icon" && (
          <text
            x={ecx}
            y={ecy + b * ICON_TEXT_BASELINE_OFFSET}
            textAnchor="middle"
            fontFamily="Outfit, 'Helvetica Neue', Arial, sans-serif"
            fontWeight="900"
            fontSize={b * 0.32}
            fill="#c2d6ff"
            fillOpacity="0.88"
          >
            4
          </text>
        )}
      </g>

      {/* ── Wordmark (non-icon variants) ─────────────────────────────────── */}
      {variant !== "icon" && (
        <text
          x={cfg.textX}
          y={cfg.textY}
          fontFamily="Outfit, 'Helvetica Neue', Arial, sans-serif"
          fontWeight="700"
          fontSize={cfg.fontSize}
          fill={cfg.textColor}
        >
          GL<tspan fill={cfg.fourColor}>4</tspan>NCE
        </text>
      )}
    </svg>
  );
}
