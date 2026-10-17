import { useSession } from "@/app/store";
import { Breadcrumb } from "./Breadcrumb";
import { FilterChips } from "./FilterChips";
import { FilterMenu } from "./FilterMenu";
import { SearchField } from "./SearchField";
import { SimilarBar } from "./SimilarBar";

export function Toolbar({ leading }: { leading?: React.ReactNode }) {
  const similar = useSession((s) => s.browse.similar !== null);
  const semantic = useSession((s) => s.browse.results.semantic);

  if (similar) return <SimilarBar leading={leading} />;

  return (
    <header
      data-tauri-drag-region
      data-semantic={semantic ? "true" : "false"}
      className="flex h-12 shrink-0 items-center gap-2 px-6"
    >
      {leading}
      <Breadcrumb />
      <FilterChips />
      <SearchField />
      <FilterMenu />
    </header>
  );
}
