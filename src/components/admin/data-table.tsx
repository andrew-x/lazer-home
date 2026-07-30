// `DataTable` now lives in a neutral, app-wide location so the People-management
// tables can use it too — it was never admin-specific. Re-exported here so the
// admin import-preview tables keep their existing `./data-table` import site,
// exactly as `./table-filters` does for the shared filter controls.
export { DataTable } from "@/components/data-table";
