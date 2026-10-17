import { useSession } from "@/app/store";
import { useVaultPath } from "@/app/selectors";
import { Breadcrumb } from "./Breadcrumb";
import { FilterChips } from "./FilterChips";
import { FilterMenu } from "./FilterMenu";
import { SearchField } from "./SearchField";
import { SimilarBar } from "./SimilarBar";

export function Toolbar({ leading }: { leading?: React.ReactNode }) {
  const similar = useSession((s) => s.browse.similar !== null);
  const semantic = useSession((s) => s.browse.results.semantic);
  const open = useVaultPath() !== null;

  if (similar) return <SimilarBar leading={leading} />;

  return (
    <header
      data-tauri-drag-region
      data-semantic={semantic ? "true" : "false"}
      className="flex h-12 shrink-0 items-center gap-2 px-6"
    >
      {leading}
      {open ? (
        <>
          <Breadcrumb />
          <FilterChips />
          <SearchField />
          <FilterMenu />
        </>
      ) : null}
    </header>
  );
}
