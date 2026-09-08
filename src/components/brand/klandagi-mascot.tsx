import { cn } from "@/lib/utils";
import { APP_MASCOT_ALT } from "@/lib/brand";

type KlandagiMascotProps = {
  className?: string;
  /** When true, render as a decorative icon (hidden from assistive tech). */
  decorative?: boolean;
};

/** Cute kawaii mountain lion — Cherokee *klandagi* (cougar). */
export function KlandagiMascot({ className, decorative = false }: KlandagiMascotProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      role={decorative ? "presentation" : "img"}
      aria-label={decorative ? undefined : APP_MASCOT_ALT}
      className={cn("shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="klandagi-fur" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f5d0a9" />
          <stop offset="100%" stopColor="#e8b87a" />
        </linearGradient>
        <linearGradient id="klandagi-bandana" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#15803d" />
        </linearGradient>
      </defs>
      {/* Tail */}
      <path
        d="M12 44c-2 6 0 14 8 16 4 1 2-4-2-8-3-3-4-8-6-8z"
        fill="url(#klandagi-fur)"
        stroke="#c9956a"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Body */}
      <ellipse cx="34" cy="42" rx="18" ry="14" fill="url(#klandagi-fur)" />
      {/* Paws */}
      <ellipse cx="24" cy="52" rx="5" ry="3" fill="#f0c896" />
      <ellipse cx="34" cy="53" rx="5" ry="3" fill="#f0c896" />
      <ellipse cx="44" cy="52" rx="5" ry="3" fill="#f0c896" />
      {/* Head */}
      <circle cx="34" cy="26" r="16" fill="url(#klandagi-fur)" />
      {/* Ears */}
      <path d="M22 16l-4-8 8 4z" fill="#e8b87a" stroke="#c9956a" strokeWidth="1" />
      <path d="M46 16l4-8-8 4z" fill="#e8b87a" stroke="#c9956a" strokeWidth="1" />
      <path d="M23 14l-2-4 4 2z" fill="#ffb6c8" />
      <path d="M45 14l2-4-4 2z" fill="#ffb6c8" />
      {/* Cheek fluff */}
      <ellipse cx="22" cy="30" rx="5" ry="4" fill="#f5d0a9" opacity="0.9" />
      <ellipse cx="46" cy="30" rx="5" ry="4" fill="#f5d0a9" opacity="0.9" />
      {/* Muzzle */}
      <ellipse cx="34" cy="32" rx="9" ry="7" fill="#fff5eb" />
      {/* Eyes — kawaii big sparkle */}
      <ellipse cx="27" cy="24" rx="4.5" ry="5.5" fill="#1e293b" />
      <ellipse cx="41" cy="24" rx="4.5" ry="5.5" fill="#1e293b" />
      <circle cx="28.5" cy="22" r="1.8" fill="#fff" />
      <circle cx="42.5" cy="22" r="1.8" fill="#fff" />
      <circle cx="26.5" cy="25.5" r="0.9" fill="#fff" opacity="0.7" />
      <circle cx="40.5" cy="25.5" r="0.9" fill="#fff" opacity="0.7" />
      {/* Nose */}
      <ellipse cx="34" cy="31" rx="2.2" ry="1.6" fill="#475569" />
      {/* Smile */}
      <path
        d="M28 34q6 6 12 0"
        fill="none"
        stroke="#475569"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* Whiskers */}
      <path d="M18 30h8M18 33h7M46 30H38M46 33h-7" stroke="#c9956a" strokeWidth="0.8" strokeLinecap="round" />
      {/* Bandana */}
      <path
        d="M20 36c4-2 20-2 24 0v6c-4 3-20 3-24 0z"
        fill="url(#klandagi-bandana)"
      />
      <path d="M38 42l4 6 2-7z" fill="#15803d" />
      {/* Spots */}
      <circle cx="30" cy="40" r="1.5" fill="#c9956a" opacity="0.5" />
      <circle cx="38" cy="44" r="1.2" fill="#c9956a" opacity="0.5" />
      <circle cx="42" cy="38" r="1" fill="#c9956a" opacity="0.45" />
    </svg>
  );
}
