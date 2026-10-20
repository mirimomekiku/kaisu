import { Loader2, Search, X } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  placeholder: string;
  /** What is searched, for the accessible name ("YouTube"). */
  sourceName?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

/** The rounded Aqua search field. One box for both pasting a link and searching YouTube. */
export default function SearchField({ value, onChange, onSubmit, busy, placeholder, inputRef, sourceName = "YouTube" }: Props) {
  return (
    <form
      className="searchfield"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <span className="lead">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={`Search ${sourceName} or paste a link`}
        spellCheck={false}
        autoComplete="off"
        autoFocus
      />
      {value && (
        <button type="button" className="trail" aria-label="Clear" title="Clear" onClick={() => onChange("")}>
          <X className="w-3 h-3" />
        </button>
      )}
    </form>
  );
}
