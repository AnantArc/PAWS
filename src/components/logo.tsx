import { cn } from "@/lib/utils";

/**
 * THE ANANT ARC PAWS badge — the official artwork (/logo.jpg),
 * used everywhere in the console.
 */
export function Logo({
  size = 32,
  className,
  withText = false,
}: {
  size?: number;
  className?: string;
  withText?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.jpg"
        alt="ANANT ARC PAWS"
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="shrink-0 select-none rounded-full object-cover shadow-sm ring-1 ring-border-subtle"
        draggable={false}
      />
      {withText && (
        <div className="flex flex-col leading-none">
          <span className="whitespace-nowrap text-[15px] font-black tracking-tight text-text-primary">
            PAWS
          </span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
            ANANT ARC
          </span>
        </div>
      )}
    </span>
  );
}
