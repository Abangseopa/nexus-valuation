import { useState } from "react";
import { RefreshCw } from "lucide-react";

interface EditAssumptionsProps {
  valuationType: "dcf" | "lbo";
  assumptions: Record<string, any>;
  onRegenerate: (message: string) => void;
  isRegenerating: boolean;
}

interface FieldDef {
  key: string;
  label: string;
  path: string;
  suffix: string;
  step: number;
}

const DCF_FIELDS: FieldDef[] = [
  { key: "wacc", label: "WACC", path: "wacc", suffix: "%", step: 0.1 },
  { key: "terminalGrowthRate", label: "Terminal Growth", path: "terminalGrowthRate", suffix: "%", step: 0.1 },
  { key: "ebitdaMargin", label: "EBITDA Margin", path: "ebitdaMargin", suffix: "%", step: 0.5 },
  { key: "revenueGrowthYear1", label: "Rev Growth Y1", path: "revenueGrowthRates[0]", suffix: "%", step: 0.5 },
];

const LBO_FIELDS: FieldDef[] = [
  { key: "entryEbitdaMultiple", label: "Entry Multiple", path: "entryEbitdaMultiple", suffix: "x", step: 0.1 },
  { key: "exitEbitdaMultiple", label: "Exit Multiple", path: "exitEbitdaMultiple", suffix: "x", step: 0.1 },
  { key: "holdingPeriodYears", label: "Holding Period", path: "holdingPeriodYears", suffix: " yrs", step: 1 },
  { key: "debtToEbitda", label: "Debt / EBITDA", path: "debtToEbitda", suffix: "x", step: 0.1 },
];

function resolveValue(assumptions: Record<string, any>, path: string): number | null {
  if (path === "revenueGrowthRates[0]") {
    const rates = assumptions?.revenueGrowthRates;
    if (Array.isArray(rates) && rates.length > 0) return toDisplayPercent(rates[0]);
    return null;
  }
  const val = assumptions?.[path];
  if (val == null) return null;
  // Convert decimals to percentage display for percent fields
  if (["wacc", "terminalGrowthRate", "ebitdaMargin"].includes(path)) {
    return toDisplayPercent(val);
  }
  return Number(val);
}

function toDisplayPercent(v: any): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  if (isNaN(n)) return 0;
  return n <= 1 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10;
}

const FIELD_LABELS_FOR_MESSAGE: Record<string, string> = {
  wacc: "WACC",
  terminalGrowthRate: "terminal growth rate",
  ebitdaMargin: "EBITDA margin",
  revenueGrowthYear1: "revenue growth year 1",
  entryEbitdaMultiple: "entry EBITDA multiple",
  exitEbitdaMultiple: "exit EBITDA multiple",
  holdingPeriodYears: "holding period",
  debtToEbitda: "debt to EBITDA",
};

export function EditAssumptions({ valuationType, assumptions, onRegenerate, isRegenerating }: EditAssumptionsProps) {
  const fields = valuationType === "dcf" ? DCF_FIELDS : LBO_FIELDS;

  const initialValues: Record<string, number> = {};
  fields.forEach((f) => {
    const v = resolveValue(assumptions, f.path);
    initialValues[f.key] = v ?? 0;
  });

  const [values, setValues] = useState(initialValues);
  const [originals] = useState(initialValues);

  const handleChange = (key: string, val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num)) {
      setValues((prev) => ({ ...prev, [key]: num }));
    }
  };

  const handleRegenerate = () => {
    const changes: string[] = [];
    fields.forEach((f) => {
      if (values[f.key] !== originals[f.key]) {
        const suffix = f.suffix === "x" ? "x" : f.suffix === " yrs" ? " years" : "%";
        changes.push(`${FIELD_LABELS_FOR_MESSAGE[f.key]} to ${values[f.key]}${suffix}`);
      }
    });

    if (changes.length === 0) {
      // No changes, regenerate with same assumptions
      onRegenerate("regenerate the model with the same assumptions");
      return;
    }

    const message = `update ${changes.join(", ")}`;
    onRegenerate(message);
  };

  return (
    <div className="border-t border-border">
      <div className="px-4 py-3">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-3">
          Edit Assumptions
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {fields.map((f) => (
            <div key={f.key} className="flex items-center gap-2">
              <label className="text-[11px] text-muted-foreground whitespace-nowrap min-w-[90px]">
                {f.label}
              </label>
              <div className="flex items-center gap-1 flex-1">
                <input
                  type="number"
                  step={f.step}
                  value={values[f.key]}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                  className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs font-mono text-foreground outline-none focus:border-primary/50 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-[10px] text-muted-foreground font-mono">{f.suffix}</span>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={handleRegenerate}
          disabled={isRegenerating}
          className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${isRegenerating ? "animate-spin" : ""}`} />
          Regenerate Model
        </button>
      </div>
    </div>
  );
}
