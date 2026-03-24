import { FileSpreadsheet, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { ValuationResult } from "@/lib/valuation-api";
import { EditAssumptions } from "./EditAssumptions";

interface ValuationResultCardProps {
  result: ValuationResult;
  onRegenerate?: (message: string) => void;
  isRegenerating?: boolean;
}

export function ValuationResultCard({ result, onRegenerate, isRegenerating = false }: ValuationResultCardProps) {
  const { ticker, companyName, valuationType, fileUrl, assumptions } = result;
  const explanation = assumptions?._explanation || "";
  const isDCF = valuationType === "dcf";

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden max-w-xl">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/15">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold tracking-wide">{ticker}</span>
            <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
              {valuationType.toUpperCase()}
            </span>
          </div>
          {companyName && <p className="text-xs text-muted-foreground">{companyName}</p>}
        </div>
      </div>

      {/* Key Stats */}
      <div className="grid grid-cols-2 gap-px bg-border">
        {isDCF ? (
          <>
            <Stat label="WACC" value={formatPercent(assumptions?.wacc)} />
            <Stat label="Terminal Growth" value={formatPercent(assumptions?.terminalGrowthRate)} />
            <Stat label="EBITDA Margin" value={formatPercent(assumptions?.ebitdaMargin)} />
            <Stat label="Forecast Years" value={assumptions?.forecastYears || "—"} />
          </>
        ) : (
          <>
            <Stat label="Entry Multiple" value={formatMultiple(assumptions?.entryEbitdaMultiple)} />
            <Stat label="Exit Multiple" value={formatMultiple(assumptions?.exitEbitdaMultiple)} />
            <Stat label="Holding Period" value={assumptions?.holdingPeriodYears ? `${assumptions.holdingPeriodYears} years` : "—"} />
            <Stat label="Leverage" value={formatMultiple(assumptions?.debtToEbitda)} />
          </>
        )}
      </div>

      {/* Commentary */}
      {explanation && (
        <div className="px-4 py-3 border-t border-border">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-2">Analyst Notes</p>
          <div className="text-xs text-secondary-foreground leading-relaxed prose prose-invert prose-xs max-w-none [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_strong]:text-foreground [&_p]:my-1">
            <ReactMarkdown>{explanation}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Edit Assumptions */}
      {onRegenerate && (
        <EditAssumptions
          valuationType={valuationType}
          assumptions={assumptions}
          onRegenerate={onRegenerate}
          isRegenerating={isRegenerating}
        />
      )}

      {/* Download */}
      {fileUrl && (
        <div className="px-4 py-3 border-t border-border">
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-success text-success-foreground text-sm font-medium hover:bg-success/90 transition-colors"
          >
            <Download className="h-4 w-4" />
            Download Excel Model
          </a>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card px-4 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
      <p className="font-mono text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function formatPercent(v: any): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return String(v);
  return n > 1 ? `${n.toFixed(1)}%` : `${(n * 100).toFixed(1)}%`;
}

function formatMultiple(v: any): string {
  if (v == null) return "—";
  return `${Number(v).toFixed(1)}x`;
}
