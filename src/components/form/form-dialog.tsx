"use client";

import {
  Fragment,
  type ReactElement,
  type ReactNode,
  useCallback,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Open + remount state for a dialog whose form must reset to fresh defaults each
 * time it opens. Bumping `formKey` on open remounts the form subtree; unlike
 * gating render on `open`, the form stays mounted through the close animation so
 * the popup doesn't collapse to its header before fading out.
 *
 * Pass `controlled` to drive open state from a parent (e.g. an inline dialog
 * opened from within another form); omit it to self-manage.
 */
export function useRemountOnOpen(controlled?: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const open = controlled?.open ?? internalOpen;
  const setOpen = controlled?.onOpenChange ?? setInternalOpen;

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) setFormKey((k) => k + 1);
      setOpen(next);
    },
    [setOpen],
  );

  const close = useCallback(() => setOpen(false), [setOpen]);

  return { open, formKey, onOpenChange, close };
}

/**
 * The shared shell for a form dialog: the `Dialog` open + `formKey` remount
 * state, an optional `trigger`, the title/description header, and the (keyed,
 * remount-on-open) form subtree. `children` is a render prop handed a `close`
 * callback — call it from the action's `onSuccess`/`onCreated` to close on save.
 * The rendered form supplies its own `<form>` and footer (see `FormDialogFooter`).
 *
 * Omit `trigger` and pass `open`/`onOpenChange` to drive the dialog from a
 * parent (inline create-from-form dialogs).
 */
export function FormDialog({
  trigger,
  title,
  description,
  open,
  onOpenChange,
  contentClassName,
  forceMountOverlay,
  children,
}: {
  trigger?: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  contentClassName?: string;
  forceMountOverlay?: boolean;
  children: (args: { close: () => void }) => ReactNode;
}) {
  const controlled =
    open !== undefined && onOpenChange !== undefined
      ? { open, onOpenChange }
      : undefined;
  const state = useRemountOnOpen(controlled);

  return (
    <Dialog open={state.open} onOpenChange={state.onOpenChange}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogContent
        className={contentClassName}
        forceMountOverlay={forceMountOverlay}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <Fragment key={state.formKey}>
          {children({ close: state.close })}
        </Fragment>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The standard form-dialog footer: the optional destructive server-error line
 * followed by a `DialogClose`-rendered "Cancel" and a submit button. Render this
 * inside the form's `<form>` so the submit button submits it.
 */
export function FormDialogFooter({
  serverError,
  submitLabel,
  loading,
}: {
  serverError?: string | null;
  submitLabel: string;
  loading?: boolean;
}) {
  return (
    <>
      {serverError ? (
        <p className="text-sm text-destructive">{serverError}</p>
      ) : null}
      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline">
              Cancel
            </Button>
          }
        />
        <Button type="submit" loading={loading}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
