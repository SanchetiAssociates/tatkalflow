const STEPS = ["Account", "Passenger", "Journey"] as const;

export function OnboardingSteps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol aria-label="Setup progress" className="mb-6 flex gap-2">
      {STEPS.map((s, i) => (
        <li key={s} className="flex-1" aria-current={i === current ? "step" : undefined}>
          <span className={`block h-1.5 rounded-full ${i <= current ? "bg-primary" : "bg-surface-2"}`} />
          <span className={`mt-1.5 block text-xs font-medium ${i === current ? "text-text" : "text-muted"}`}>
            {i + 1}. {s}
            {i < current && <span className="sr-only"> (done)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
