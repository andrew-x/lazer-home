"use client";

import { useId, useMemo, useState } from "react";
import type { FeedbackAboutReportsRow } from "@/actions/feedback/getFeedbackAboutReports";
import { EmptyState } from "@/components/empty-state";
import { FeedbackDetailDialog } from "@/components/feedback/feedback-detail-dialog";
import {
  FilterLabel,
  type SearchableOption,
  SearchableSelectFilter,
} from "@/components/form/filters";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatIsoDate, formatTimestamp } from "@/lib/format/format";

/** Distinct `{ id, name }` people in the rows, sorted by name. */
function peopleOptions(
  rows: FeedbackAboutReportsRow[],
  pick: (row: FeedbackAboutReportsRow) => SearchableOption,
): SearchableOption[] {
  const byId = new Map<string, SearchableOption>();
  for (const row of rows) {
    const option = pick(row);
    byId.set(option.id, option);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Feedback about the caller's direct reports. Filtering is in-memory over the
 * list fetched once on the server (the staff-directory pattern rather than the
 * URL-backed list filters — these controls live inside an uncontrolled `Tabs`,
 * so writing search params would mean making tab selection URL-driven too, and
 * one manager's reports is a small enough set to filter client-side).
 *
 * Only reviewers reach this table (see `getFeedbackAboutReports`), so rows carry
 * full content and open in the shared detail dialog.
 */
export function FeedbackAboutReportsTable({
  rows,
}: {
  rows: FeedbackAboutReportsRow[];
}) {
  const fromId = useId();
  const toId = useId();
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [giverId, setGiverId] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedbackAboutReportsRow | null>(
    null,
  );
  const [open, setOpen] = useState(false);

  // Only people who actually appear in the list are offerable as filters.
  const recipientOptions = useMemo(
    () =>
      peopleOptions(rows, (row) => ({
        id: row.recipientId,
        name: row.recipientName,
      })),
    [rows],
  );
  const giverOptions = useMemo(
    () =>
      peopleOptions(rows, (row) => ({ id: row.giverId, name: row.giverName })),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (recipientId && row.recipientId !== recipientId) return false;
        if (giverId && row.giverId !== giverId) return false;
        // Compare on the same calendar day the Date column shows: `createdAt` is
        // a timezone-less timestamp, so formatting it to "YYYY-MM-DD" and
        // string-comparing keeps the filter and the display in agreement.
        const day = formatIsoDate(row.createdAt);
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      }),
    [rows, recipientId, giverId, from, to],
  );

  if (rows.length === 0) {
    return (
      <EmptyState bordered>
        None of your direct reports have received feedback yet.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 items-end gap-4">
        <SearchableSelectFilter
          label="For"
          value={recipientId}
          options={recipientOptions}
          placeholder="Anyone"
          onChange={setRecipientId}
          inputClassName="w-full"
        />
        <SearchableSelectFilter
          label="Author"
          value={giverId}
          options={giverOptions}
          placeholder="Anyone"
          onChange={setGiverId}
          inputClassName="w-full"
        />
        <div className="flex flex-col gap-1.5">
          <FilterLabel htmlFor={fromId}>From</FilterLabel>
          <DatePicker
            id={fromId}
            value={from}
            // Endpoints can't cross: a start after the current end drops the end.
            onChange={(next) => {
              setFrom(next);
              if (next && to && next > to) setTo(null);
            }}
            placeholder="Any date"
            className="w-full"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FilterLabel htmlFor={toId}>To</FilterLabel>
          <DatePicker
            id={toId}
            value={to}
            onChange={(next) => {
              setTo(next);
              if (next && from && next < from) setFrom(null);
            }}
            placeholder="Any date"
            className="w-full"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No feedback matches these filters.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Author</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Context</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.giverName}</TableCell>
                  <TableCell className="font-medium">
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => {
                        setSelected(row);
                        setOpen(true);
                      }}
                    >
                      {row.recipientName}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-md text-muted-foreground">
                    <span className="line-clamp-2">{row.context}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatTimestamp(row.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FeedbackDetailDialog
        item={selected}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}
