import { type Currency, formatMoney } from "@/lib/format/currency";

/** A compensation label/value row, or an em dash when absent. */
function MoneyRow({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: number | null;
  currency: Currency | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      {amount == null ? (
        <span className="font-medium text-muted-foreground">—</span>
      ) : (
        <span className="text-right font-medium">
          {currency
            ? formatMoney(amount, currency)
            : new Intl.NumberFormat().format(amount)}
        </span>
      )}
    </div>
  );
}

/**
 * Read view of a person's compensation, rendered inside the profile's
 * Compensation card. Only shown to viewers allowed to see it (see
 * canViewCompensation) — this component assumes that gate has already passed.
 */
export function CompensationSection({
  base,
  hourlyRate,
  guaranteedBonus,
  discretionaryBonus,
  currency,
}: {
  base: number | null;
  hourlyRate: number | null;
  guaranteedBonus: number | null;
  discretionaryBonus: number | null;
  currency: Currency | null;
}) {
  const hasAny =
    base != null ||
    hourlyRate != null ||
    guaranteedBonus != null ||
    discretionaryBonus != null;

  if (!hasAny) {
    return (
      <p className="text-sm text-muted-foreground">No compensation on file.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <MoneyRow label="Base" amount={base} currency={currency} />
      <MoneyRow label="Hourly rate" amount={hourlyRate} currency={currency} />
      {/* Bonuses are hidden when zero (nothing to show). */}
      {guaranteedBonus ? (
        <MoneyRow
          label="Guaranteed bonus"
          amount={guaranteedBonus}
          currency={currency}
        />
      ) : null}
      {discretionaryBonus ? (
        <MoneyRow
          label="Discretionary bonus"
          amount={discretionaryBonus}
          currency={currency}
        />
      ) : null}
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-muted-foreground">Currency</span>
        <span className="font-medium">{currency ?? "—"}</span>
      </div>
    </div>
  );
}
