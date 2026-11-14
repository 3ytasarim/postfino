"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = /Not allowed|FORBIDDEN|not found/i.test(error.message);
  return (
    <div className="card mx-auto max-w-lg p-8 text-center" role="alert">
      <h1 className="text-2xl font-bold">{forbidden ? "Kein Zugriff" : "Etwas ist schiefgelaufen"}</h1>
      <p className="mt-3 text-ink-2">{forbidden ? "Dieser Inhalt existiert nicht oder gehört nicht zu deiner Marke." : "Der Fehler wurde protokolliert."}</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-3">Ref: {error.digest}</p>}
      <button className="btn btn-primary mt-6" onClick={reset}>
        Erneut versuchen
      </button>
    </div>
  );
}
