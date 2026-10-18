import { useSession } from "@/app/store";
import { useVaultPath } from "@/app/selectors";
import { Breadcrumb } from "./Breadcrumb";
import { FilterChips } from "./FilterChips";
import { FilterMenu } from "./FilterMenu";
import { SearchField } from "./SearchField";
import { LensBar } from "./LensBar";

export function Toolbar({ leading }: { leading?: React.ReactNode }) {
  const lens = useSession((s) => s.browse.lens);
  const semantic = useSession((s) => s.browse.results.semantic);
  const open = useVaultPath() !== null;

  if (lens) return <LensBar lens={lens} leading={leading} />;

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
