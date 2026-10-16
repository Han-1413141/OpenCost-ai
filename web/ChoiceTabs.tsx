export function ChoiceTabs({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="choice-tabs" role="group" aria-label={label}>
      {options.map(([id, title]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={(event) => {
            onChange(id);
            event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }}
        >
          {title}
        </button>
      ))}
    </div>
  );
}
