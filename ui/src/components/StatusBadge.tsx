interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config: Record<string, { label: string; className: string }> = {
    pending: { label: "Pending", className: "bg-warning/15 text-warning" },
    fetching_data: { label: "Fetching", className: "bg-warning/15 text-warning" },
    generating: { label: "Building", className: "bg-warning/15 text-warning" },
    complete: { label: "Complete", className: "bg-success/15 text-success" },
    error: { label: "Error", className: "bg-destructive/15 text-destructive" },
  };

  const c = config[status] || config.pending;

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider ${c.className}`}>
      {c.label}
    </span>
  );
}
