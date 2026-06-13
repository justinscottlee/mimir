"use client";

/** Shared scaffold for sections that are planned but not built yet. */
export default function StubPage({
  eyebrow,
  title,
  description,
  notes,
}: {
  eyebrow: string;
  title: string;
  description: string;
  notes?: string[];
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-bronze-500">
        {eyebrow}
      </div>
      <h1 className="mt-2 text-xl font-semibold text-parchment-100">{title}</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-parchment-400">
        {description}
      </p>
      {notes && notes.length > 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-ink-700 p-5">
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
