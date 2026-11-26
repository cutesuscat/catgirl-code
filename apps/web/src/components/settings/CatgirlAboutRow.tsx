/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code feature, English only: upstream's catalogs stay untouched */
import { CATGIRL_FORK_NOTICE, CATGIRL_RELEASES_PAGE_URL } from "@t3tools/shared/catgirlRelease";

import { Button } from "../ui/button";
import { SettingsRow } from "./settingsLayout";

/** Says in the app itself that it is an unofficial fork, and where its builds come from. */
export function CatgirlAboutRow() {
  return (
    <SettingsRow
      title="Unofficial fork"
      description={CATGIRL_FORK_NOTICE}
      control={
        <Button
          render={<a href={CATGIRL_RELEASES_PAGE_URL} target="_blank" rel="noreferrer noopener" />}
          size="sm"
          variant="outline"
        >
          Releases
        </Button>
      }
    />
  );
}
