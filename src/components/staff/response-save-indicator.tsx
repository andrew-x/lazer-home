// The autosave status indicator now lives in a neutral, app-wide location so the
// compensation-plan editor can share it with the profile surveys. Re-exported
// here so the survey guides keep their existing `./response-save-indicator`
// import site (same shim pattern as `admin/table-filters.tsx`).
export {
  aggregateSaveState,
  SaveIndicator,
} from "@/components/form/save-indicator";
