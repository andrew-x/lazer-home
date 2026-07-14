import type { BaseSyntheticEvent } from "react";

/**
 * Wrap an inline-dialog form's submit handler so it can't bubble to the form
 * that opened it. These dialogs are portaled but remain React descendants of
 * the parent form, so their submit would otherwise bubble up and validate the
 * parent. Stop it at the boundary, then delegate to the real handler.
 */
export function stopBubblingSubmit(
  handleSubmitWithAction: (e?: BaseSyntheticEvent) => unknown,
): (e: BaseSyntheticEvent) => void {
  return (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleSubmitWithAction(e);
  };
}
