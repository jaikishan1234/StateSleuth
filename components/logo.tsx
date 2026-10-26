import { CrosshairIcon } from "@/components/icons";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <a href={href} className="group flex items-center gap-2.5">
      <span className="relative grid size-9 place-items-center rounded-xl border border-hairline bg-elevated">
        <CrosshairIcon className="size-5 text-verified transition-transform duration-300 group-hover:rotate-90" />
      </span>
      <span className="text-[0.95rem] font-semibold tracking-tight text-ink">
        State<span className="text-verified">Sleuth</span>
      </span>
    </a>
  );
}