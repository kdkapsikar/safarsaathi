/**
 * Saathi, the assistant's mascot: an anime-style electric locomotive idling at a
 * level crossing. A 10-second loop tells a small story:
 *   signal red, gate up -> signal yellow, gate lowers, crossing lights flash ->
 *   signal green, Saathi says hello -> gate rises, back to red.
 * All motion is CSS (see `.saathi-*` in index.css) and stops under
 * prefers-reduced-motion, leaving a calm still frame.
 */
export function SaathiScene({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 360 200"
      role="img"
      aria-label="Saathi, a friendly red locomotive with big eyes, waiting at a level crossing beside a signal"
      className={`saathi-scene ${className}`}
    >
      <defs>
        <linearGradient id="saathi-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cfe6e2" />
          <stop offset="1" stopColor="#f7f4ec" />
        </linearGradient>
        <linearGradient id="saathi-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e2483d" />
          <stop offset="1" stopColor="#b5271f" />
        </linearGradient>
        <linearGradient id="saathi-beam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffe9a8" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="saathi-glow">
          <stop offset="0" stopColor="#fff7d1" />
          <stop offset="1" stopColor="#fff7d1" stopOpacity="0" />
        </radialGradient>
        <pattern id="saathi-stripes" width="16" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#c62828" />
          <rect x="8" width="8" height="8" fill="#ffffff" />
        </pattern>
      </defs>

      {/* Sky, sun, hills, drifting cloud */}
      <rect width="360" height="200" fill="url(#saathi-sky)" />
      <circle cx="44" cy="38" r="16" fill="#f2b134" opacity="0.9" />
      <circle className="saathi-sun-halo" cx="44" cy="38" r="24" fill="#f2b134" opacity="0.18" />
      <path d="M0 150 Q60 112 130 140 T260 132 T360 128 V170 H0Z" fill="#b9d8c9" />
      <path d="M0 158 Q90 132 180 152 T360 146 V170 H0Z" fill="#9cc7b3" />
      <g className="saathi-cloud">
        <ellipse cx="150" cy="34" rx="22" ry="9" fill="#fff" opacity="0.9" />
        <ellipse cx="166" cy="29" rx="14" ry="9" fill="#fff" opacity="0.9" />
        <ellipse cx="136" cy="31" rx="11" ry="7" fill="#fff" opacity="0.9" />
      </g>

      {/* Overhead wire (Saathi is electric) */}
      <line x1="0" y1="64" x2="360" y2="64" stroke="#3b4a48" strokeWidth="1.2" />
      <line x1="96" y1="58" x2="96" y2="64" stroke="#3b4a48" strokeWidth="1" />
      <line x1="300" y1="58" x2="300" y2="64" stroke="#3b4a48" strokeWidth="1" />
      <line x1="0" y1="58" x2="360" y2="58" stroke="#3b4a48" strokeWidth="0.8" opacity="0.6" />

      {/* Ground, ballast, sleepers, rail with a travelling glint */}
      <rect y="168" width="360" height="32" fill="#c9b99a" />
      <path d="M0 170 H360 V180 H0Z" fill="#a39780" />
      {Array.from({ length: 17 }, (_, i) => (
        <rect key={i} x={4 + i * 22} y="168" width="13" height="6" rx="1" fill="#6b5a45" />
      ))}
      <rect y="163" width="360" height="5" fill="#5f6b6a" />
      <rect y="163" width="360" height="1.5" fill="#c7d0cf" />
      <rect
        className="saathi-rail-glint"
        y="163"
        width="40"
        height="2"
        fill="#ffffff"
        opacity="0.8"
      />

      {/* Level-crossing gate (left) */}
      <g>
        <rect x="66" y="112" width="6" height="56" rx="1.5" fill="#3b4a48" />
        <g transform="translate(69 104)">
          <rect
            x="-11"
            y="-2"
            width="22"
            height="4"
            rx="1"
            fill="#fff"
            stroke="#c62828"
            transform="rotate(35)"
          />
          <rect
            x="-11"
            y="-2"
            width="22"
            height="4"
            rx="1"
            fill="#fff"
            stroke="#c62828"
            transform="rotate(-35)"
          />
        </g>
        <g className="saathi-xing-lights">
          <rect x="56" y="124" width="26" height="9" rx="4.5" fill="#1f2a29" />
          <circle className="saathi-xing-a" cx="62" cy="128.5" r="3" fill="#ff4b3e" />
          <circle className="saathi-xing-b" cx="76" cy="128.5" r="3" fill="#ff4b3e" />
        </g>
        <g className="saathi-gate-arm">
          <rect
            x="4"
            y="138"
            width="65"
            height="6"
            rx="3"
            fill="url(#saathi-stripes)"
            stroke="#8a1c1c"
            strokeWidth="0.6"
          />
          <circle cx="69" cy="141" r="4" fill="#3b4a48" />
        </g>
      </g>

      {/* Railway signal (right) */}
      <g>
        <rect x="330" y="76" width="5" height="92" fill="#3b4a48" />
        <rect x="320" y="70" width="25" height="52" rx="6" fill="#1f2a29" />
        <path
          d="M320 82 h-4 M320 96 h-4 M320 110 h-4"
          stroke="#1f2a29"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle className="saathi-sig-red" cx="332.5" cy="82" r="5.5" fill="#ff4b3e" />
        <circle className="saathi-sig-yellow" cx="332.5" cy="96" r="5.5" fill="#ffc83d" />
        <circle className="saathi-sig-green" cx="332.5" cy="110" r="5.5" fill="#3ee08a" />
      </g>

      {/* Headlight beam, behind Saathi */}
      <path className="saathi-beam" d="M262 72 L360 52 L360 96 Z" fill="url(#saathi-beam)" />

      {/* Saathi: chibi proportions, short body and a big expressive cab */}
      <g className="saathi-body">
        {/* Pantograph */}
        <g stroke="#3b4a48" strokeWidth="1.6" fill="none" strokeLinejoin="round">
          <path d="M146 97 L156 80 L166 97 M148 97 L156 66 L164 97" />
          <line x1="146" y1="65" x2="166" y2="65" strokeWidth="2.4" strokeLinecap="round" />
        </g>
        <circle className="saathi-spark" cx="156" cy="64" r="3" fill="#bfefff" />

        {/* Body */}
        <rect x="108" y="96" width="112" height="58" rx="10" fill="url(#saathi-body)" />
        <g fill="#8c1d17" opacity="0.55">
          {[0, 1, 2].map((i) => (
            <rect key={i} x={120 + i * 9} y="104" width="5" height="16" rx="1.5" />
          ))}
        </g>
        <rect
          x="178"
          y="103"
          width="20"
          height="22"
          rx="3"
          fill="#9fd3e6"
          stroke="#8c1d17"
          strokeWidth="1.5"
        />
        <rect x="182" y="106" width="5" height="12" rx="1.5" fill="#ffffff" opacity="0.6" />
        <rect x="108" y="138" width="112" height="8" fill="#f5e6c8" />
        <text
          x="162"
          y="134"
          textAnchor="middle"
          fontSize="7"
          fontWeight="700"
          fill="#f5e6c8"
          letterSpacing="1"
        >
          SAATHI
        </text>

        {/* Cab = Saathi's face */}
        <path d="M206 76 H272 Q304 76 306 112 V154 H206 Z" fill="url(#saathi-body)" />
        <path
          d="M206 76 H272 Q304 76 306 112 V118 Q290 84 214 84 H206 Z"
          fill="#ffffff"
          opacity="0.12"
        />
        <path d="M206 140 H306 V148 H206 Z" fill="#f5e6c8" />
        <g className="saathi-eyes">
          <ellipse
            cx="236"
            cy="106"
            rx="12"
            ry="15"
            fill="#fff"
            stroke="#3a0f0c"
            strokeWidth="1.6"
          />
          <ellipse
            cx="272"
            cy="106"
            rx="12"
            ry="15"
            fill="#fff"
            stroke="#3a0f0c"
            strokeWidth="1.6"
          />
          <g className="saathi-pupils">
            <ellipse cx="238.5" cy="108.5" rx="7.5" ry="10" fill="#1d2b4f" />
            <ellipse cx="274.5" cy="108.5" rx="7.5" ry="10" fill="#1d2b4f" />
            <ellipse cx="238.5" cy="112" rx="5" ry="5" fill="#2f4a8a" />
            <ellipse cx="274.5" cy="112" rx="5" ry="5" fill="#2f4a8a" />
            <circle cx="241.5" cy="103" r="3.4" fill="#fff" />
            <circle cx="277.5" cy="103" r="3.4" fill="#fff" />
            <circle cx="235.5" cy="113.5" r="1.5" fill="#fff" />
            <circle cx="271.5" cy="113.5" r="1.5" fill="#fff" />
          </g>
        </g>
        <path
          d="M224 88 q12 -6 24 -1 M260 87 q12 -5 24 1"
          stroke="#3a0f0c"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
        <ellipse cx="224" cy="128" rx="6" ry="3" fill="#ff8a80" opacity="0.85" />
        <ellipse cx="286" cy="128" rx="6" ry="3" fill="#ff8a80" opacity="0.85" />
        <path
          d="M247 126 Q254 135 261 126"
          fill="#7a1a14"
          stroke="#3a0f0c"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M250.5 129.5 Q254 132 257.5 129.5" fill="#ff8a80" />
        <circle
          className="saathi-headlight-glow"
          cx="254"
          cy="72"
          r="13"
          fill="url(#saathi-glow)"
        />
        <rect
          x="246"
          y="68"
          width="16"
          height="9"
          rx="4.5"
          fill="#fff3b0"
          stroke="#8c1d17"
          strokeWidth="1"
        />

        {/* Buffers, bogies, wheels */}
        <rect x="304" y="146" width="7" height="5" rx="1.5" fill="#3b4a48" />
        <rect x="101" y="146" width="7" height="5" rx="1.5" fill="#3b4a48" />
        <rect x="114" y="150" width="56" height="7" rx="3" fill="#2c3534" />
        <rect x="214" y="150" width="70" height="7" rx="3" fill="#2c3534" />
        {[128, 156, 230, 268].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="158" r="7" fill="#2c3534" />
            <circle cx={cx} cy="158" r="2.5" fill="#9aa5a4" />
          </g>
        ))}
      </g>

      {/* Anime sparkles while Saathi says hello */}
      <g className="saathi-sparkles" fill="#f2b134">
        <path d="M204 70 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2z" />
        <path d="M312 92 l1.5 -4.5 l1.5 4.5 l4.5 1.5 l-4.5 1.5 l-1.5 4.5 l-1.5 -4.5 l-4.5 -1.5z" />
        <path d="M296 62 l1 -3 l1 3 l3 1 l-3 1 l-1 3 l-1 -3 l-3 -1z" />
      </g>

      {/* Speech bubble while the signal is green */}
      <g className="saathi-bubble">
        <path
          d="M110 14 h92 a8 8 0 0 1 8 8 v16 a8 8 0 0 1 -8 8 h-14 l4 10 l-14 -10 h-68 a8 8 0 0 1 -8 -8 v-16 a8 8 0 0 1 8 -8z"
          fill="#fff"
          stroke="#0f3d3e"
          strokeWidth="1.2"
        />
        <text x="156" y="34" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0f3d3e">
          Namaste! 🙏
        </text>
      </g>
    </svg>
  );
}

/** Just Saathi's face, for the chat launcher button. Blinks, otherwise still. */
export function SaathiFace({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={`saathi-scene ${className}`}>
      <rect x="4" y="6" width="56" height="56" rx="18" fill="#c8352c" />
      <rect x="4" y="40" width="56" height="7" fill="#f5e6c8" />
      <circle cx="32" cy="12" r="4" fill="#fff3b0" stroke="#8c1d17" strokeWidth="1" />
      <g className="saathi-eyes">
        <ellipse cx="21" cy="26" rx="8" ry="9.5" fill="#fff" stroke="#3a0f0c" strokeWidth="1.3" />
        <ellipse cx="43" cy="26" rx="8" ry="9.5" fill="#fff" stroke="#3a0f0c" strokeWidth="1.3" />
        <ellipse cx="22.5" cy="27.5" rx="5" ry="6.2" fill="#1d2b4f" />
        <ellipse cx="44.5" cy="27.5" rx="5" ry="6.2" fill="#1d2b4f" />
        <circle cx="24.5" cy="24.5" r="2.1" fill="#fff" />
        <circle cx="46.5" cy="24.5" r="2.1" fill="#fff" />
      </g>
      <ellipse cx="13" cy="38" rx="4" ry="2.2" fill="#ff8a80" opacity="0.85" />
      <ellipse cx="51" cy="38" rx="4" ry="2.2" fill="#ff8a80" opacity="0.85" />
      <path
        d="M27 36 Q32 42 37 36"
        fill="#7a1a14"
        stroke="#3a0f0c"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
