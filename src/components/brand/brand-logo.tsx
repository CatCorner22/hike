import Link from "next/link";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import { KlandagiMascot } from "@/components/brand/klandagi-mascot";

type BrandLogoProps = {
  className?: string;
  /** Icon size in Tailwind units (h-5 w-5 default). */
  iconClassName?: string;
  showWordmark?: boolean;
  asLink?: boolean;
};

export function BrandLogo({
  className,
  iconClassName = "h-8 w-8",
  showWordmark = true,
  asLink = false,
}: BrandLogoProps) {
  const content = (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <KlandagiMascot className={iconClassName} decorative />
      {showWordmark && (
        <span className="font-semibold tracking-tight">
          {APP_NAME}
          <span className="sr-only"> — mountain lion wilderness navigation</span>
        </span>
      )}
    </span>
  );

  if (asLink) {
    return (
      <Link href="/" className={cn("inline-flex items-center gap-2 font-semibold", className)}>
        <KlandagiMascot className={iconClassName} decorative />
        {showWordmark && <span>{APP_NAME}</span>}
      </Link>
    );
  }

  return content;
}
