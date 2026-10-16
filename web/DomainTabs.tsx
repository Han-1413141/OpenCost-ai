import { domainLabels, type WorkDomain } from '../shared/schema';

export function DomainTabs({
  value,
  onChange,
}: {
  value: WorkDomain;
  onChange: (value: WorkDomain) => void;
}) {
  return (
    <div className="domain-tabs" role="group" aria-label="工作领域">
      {Object.entries(domainLabels).map(([id, title]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={(event) => {
            onChange(id as WorkDomain);
            event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }}
        >
          {title}
        </button>
      ))}
    </div>
  );
}
