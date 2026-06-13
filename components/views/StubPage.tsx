"use client";

/** Shared scaffold for manager windows that are planned but not built yet. */
export default function StubPage({
  description,
  notes,
}: {
  description: string;
  notes?: string[];
}) {
  return (
    <div className="p-5">
      <p className="max-w-xl text-sm leading-relaxed text-parchment-400">
        {description}
      </p>
      {notes && notes.length > 0 && (
        <div className="mt-5 rounded-lg border border-dashed border-ink-700 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-600">
            Planned
          </div>
          <ul className="mt-3 space-y-2 text-sm text-parchment-400">
            {notes.map((n) => (
              <li key={n} className="flex gap-2.5">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-bronze-500" />
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
