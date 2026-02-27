import type { CountryNewsData, NewsEvent, EventCategory } from "./types";

interface EventModalProps {
  country: CountryNewsData | null;
  onClose: () => void;
}

const CATEGORY_STYLES: Record<EventCategory, string> = {
  violent: "bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-400",
  minor: "bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400",
  economic: "bg-blue-light-100 text-blue-light-700 dark:bg-blue-light-900/30 dark:text-blue-light-400",
};

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-error-500",
  medium: "bg-warning-500",
  low: "bg-success-500",
};

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function EventRow({ event }: { event: NewsEvent }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0 dark:border-gray-800">
      <span
        className={`mt-1.5 shrink-0 h-2 w-2 rounded-full ${SEVERITY_DOT[event.severity] ?? "bg-gray-400"}`}
        title={event.severity}
      />
      <div className="flex-1 min-w-0">
        {event.link ? (
          <a
            href={event.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-gray-800 dark:text-white/90 hover:text-brand-500 dark:hover:text-brand-400 line-clamp-2"
          >
            {event.title}
          </a>
        ) : (
          <p className="text-sm font-medium text-gray-800 dark:text-white/90 line-clamp-2">{event.title}</p>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs text-gray-500 dark:text-gray-400">{event.source}</span>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{relativeTime(event.time)}</span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[event.category]}`}
          >
            {event.category}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function EventModal({ country, onClose }: EventModalProps) {
  if (!country) return null;

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative z-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-theme-xl dark:border-gray-700 dark:bg-gray-dark max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            {country.trending && (
              <span className="inline-flex h-2 w-2 rounded-full bg-error-500 animate-pulse" />
            )}
            <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
              {country.name}
            </h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {country.events.length} event{country.events.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Event list */}
        <div className="overflow-y-auto flex-1 px-5 custom-scrollbar">
          {country.events.map((ev, i) => (
            <EventRow key={`${ev.title}-${i}`} event={ev} />
          ))}
        </div>
      </div>
    </div>
  );
}
