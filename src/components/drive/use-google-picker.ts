"use client";

import { useCallback, useRef, useState } from "react";
import { getDrivePickerToken } from "@/actions/drive/getDrivePickerToken";

/**
 * The Google Picker, which is how this feature avoids owning an uploader at all.
 *
 * Two modes, each a Picker with exactly ONE view:
 *
 * - `upload` — `DocsUploadView().setParent(folderId)`. Google's own uploader
 *   writes straight into the folder: unlimited size, progress, resumption and
 *   drag-and-drop, none of it ours. Nothing to do afterwards but refresh.
 * - `pick` — a `DocsView` over the files the user can already see. Picking moves
 *   nothing; it hands back ids, which the caller copies in via `copyDriveFile`.
 *
 * **Why two single-view Pickers rather than one Picker with both views.** A
 * combined Picker returns one undifferentiated list of PICKED documents, so the
 * caller would have to *infer* which ones Google already wrote into the folder
 * (uploads) and which still need copying (picks) — typically by comparing each
 * document's parent id. Inferring wrong in the safe direction costs an extra API
 * call; inferring wrong in the other direction silently creates a duplicate file.
 * Two views, two intents, no inference: the mode says what happened.
 *
 * The one thing this concedes: `setOAuthToken` is the only way to authorize the
 * Picker, so a Drive access token reaches the browser. That is inherent to the
 * Picker and is the acknowledged cost of not building an uploader — see
 * docs/decisions/0069. The token is the signed-in person's own and short-lived,
 * and it is fetched per-open rather than held, so it isn't kept alive in memory
 * across a long-lived tab.
 */

const PICKER_SCRIPT_SRC = "https://apis.google.com/js/api.js";

export type PickerMode = "upload" | "pick";

/** The narrow slice of the Picker API this module uses, hand-declared. */
type PickerView = object;

type PickerBuilder = {
  addView(view: PickerView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setCallback(callback: (data: PickerCallbackData) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
};

type PickerCallbackData = {
  action: string;
  docs?: Array<{ id?: string; name?: string }>;
};

type DocsUploadView = { setParent(parentId: string): DocsUploadView };
type DocsView = {
  setIncludeFolders(included: boolean): DocsView;
  setEnableDrives(enabled: boolean): DocsView;
  setMode(mode: string): DocsView;
};

type GooglePickerApi = {
  PickerBuilder: new () => PickerBuilder;
  DocsUploadView: new () => DocsUploadView;
  DocsView: new (viewId?: string) => DocsView;
  ViewId: { DOCS: string };
  Action: { PICKED: string; CANCEL: string };
  Feature: { MULTISELECT_ENABLED: string; NAV_HIDDEN: string };
  DocsViewMode: { LIST: string; GRID: string };
};

type GapiWindow = typeof window & {
  gapi?: { load(name: string, callback: () => void): void };
  google?: { picker?: GooglePickerApi };
};

/**
 * Load `api.js` and the `picker` module exactly once per page, no matter how many
 * panels mount. Module-level so a second Files tab reuses the same in-flight
 * promise rather than injecting a second script tag.
 */
let pickerLoader: Promise<GooglePickerApi> | null = null;

function loadPicker(): Promise<GooglePickerApi> {
  if (pickerLoader) return pickerLoader;

  pickerLoader = new Promise<GooglePickerApi>((resolve, reject) => {
    const win = window as GapiWindow;

    const loadModule = () => {
      const gapi = (window as GapiWindow).gapi;
      if (!gapi) {
        reject(new Error("gapi failed to load"));
        return;
      }
      gapi.load("picker", () => {
        const picker = (window as GapiWindow).google?.picker;
        if (!picker) {
          reject(new Error("picker module failed to load"));
          return;
        }
        resolve(picker);
      });
    };

    if (win.gapi) {
      loadModule();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${PICKER_SCRIPT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", loadModule);
      existing.addEventListener("error", () =>
        reject(new Error("api.js failed to load")),
      );
      return;
    }

    const script = document.createElement("script");
    script.src = PICKER_SCRIPT_SRC;
    script.async = true;
    script.onload = loadModule;
    script.onerror = () => {
      // Let a later attempt retry from scratch rather than caching the failure
      // forever — this is usually a blocked network, not a permanent condition.
      pickerLoader = null;
      reject(new Error("api.js failed to load"));
    };
    document.head.append(script);
  });

  return pickerLoader;
}

export function useGooglePicker({
  folderId,
  onPicked,
  onUploaded,
  onError,
}: {
  /** The folder uploads land in, and that copies are made into. */
  folderId: string;
  /**
   * Files chosen from the user's own Drive — the caller copies these in. May be
   * async; the Picker has already closed by the time this runs, so nothing waits
   * on it.
   */
  onPicked: (fileIds: string[]) => void | Promise<void>;
  /** Google already wrote these into the folder; just refresh. */
  onUploaded: () => void;
  onError: (message: string) => void;
}) {
  const [isOpening, setIsOpening] = useState(false);
  // Guards against a double-click opening two Pickers over each other while the
  // token request is still in flight.
  const openingRef = useRef(false);

  const open = useCallback(
    async (mode: PickerMode) => {
      if (openingRef.current) return;
      openingRef.current = true;
      setIsOpening(true);

      try {
        const [picker, tokenResult] = await Promise.all([
          loadPicker(),
          getDrivePickerToken({}),
        ]);

        if (tokenResult?.serverError) {
          onError(tokenResult.serverError);
          return;
        }
        const credentials = tokenResult?.data;
        if (
          !credentials?.accessToken ||
          !credentials.apiKey ||
          !credentials.appId
        ) {
          onError("Google Drive isn't fully configured.");
          return;
        }

        const view =
          mode === "upload"
            ? new picker.DocsUploadView().setParent(folderId)
            : new picker.DocsView(picker.ViewId.DOCS)
                .setIncludeFolders(false)
                .setEnableDrives(true)
                .setMode(picker.DocsViewMode.LIST);

        const instance = new picker.PickerBuilder()
          .setOAuthToken(credentials.accessToken)
          .setDeveloperKey(credentials.apiKey)
          .setAppId(credentials.appId)
          .setTitle(
            mode === "upload" ? "Upload to this folder" : "Add from your Drive",
          )
          .addView(view)
          .enableFeature(picker.Feature.MULTISELECT_ENABLED)
          .setCallback((data) => {
            if (data.action !== picker.Action.PICKED) return;
            const ids = (data.docs ?? [])
              .map((doc) => doc.id)
              .filter((id): id is string => Boolean(id));
            if (ids.length === 0) return;
            // The mode, not the payload, decides what happened here — see the
            // module comment on why there is one view per Picker.
            if (mode === "upload") onUploaded();
            else onPicked(ids);
          })
          .build();

        instance.setVisible(true);
      } catch {
        onError("Couldn't open the Google Drive picker.");
      } finally {
        openingRef.current = false;
        setIsOpening(false);
      }
    },
    [folderId, onPicked, onUploaded, onError],
  );

  return { open, isOpening };
}
