import { ONVIBE_BRAND } from "./brand";

interface Props {
  label: string;
}

// Shared brand header -- used on the customer report and the intake form so
// the whole tool reads as an OnVibe product, not just the client-facing
// deliverable at the end.
export function OnVibeLetterhead({ label }: Props) {
  return (
    <div className="flex items-center justify-between px-6 py-5" style={{ backgroundColor: ONVIBE_BRAND.yellow }}>
      <div className="flex items-center gap-2">
        <div
          className="h-0 w-0"
          style={{
            borderLeft: "9px solid transparent",
            borderRight: "9px solid transparent",
            borderTop: `16px solid ${ONVIBE_BRAND.coral}`,
          }}
        />
        <span className="text-lg font-black tracking-tight" style={{ color: ONVIBE_BRAND.ink }}>
          OnVibe
        </span>
      </div>
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: ONVIBE_BRAND.ink }}>
        {label}
      </span>
    </div>
  );
}
