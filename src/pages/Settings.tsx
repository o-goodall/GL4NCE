import { Link } from "react-router";
import PageMeta from "../components/common/PageMeta";
import { useTheme } from "../context/ThemeContext";

type SettingsLink = {
  label: string;
  path: string;
};

const settingsLinks: SettingsLink[] = [
  { label: "Profile", path: "/settings/profile" },
  { label: "Calendar", path: "/settings/calendar" },
  { label: "Form Elements", path: "/settings/form-elements" },
  { label: "Basic Tables", path: "/settings/basic-tables" },
  { label: "Line Chart", path: "/settings/line-chart" },
  { label: "Bar Chart", path: "/settings/bar-chart" },
  { label: "Alerts", path: "/settings/alerts" },
  { label: "Avatars", path: "/settings/avatars" },
  { label: "Badges", path: "/settings/badge" },
  { label: "Buttons", path: "/settings/buttons" },
  { label: "Images", path: "/settings/images" },
  { label: "Videos", path: "/settings/videos" },
  { label: "Blank Page", path: "/settings/blank" },
  { label: "404 Page", path: "/settings/error-404" },
  { label: "Sign In", path: "/signin" },
  { label: "Sign Up", path: "/signup" },
];

export default function Settings() {
  const { theme, toggleTheme } = useTheme();

  return (
    <>
      <PageMeta
        title="Settings | GL4NCE Dashboard"
        description="GL4NCE - Settings and utility pages"
      />

      <div className="w-full space-y-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Settings
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Access utility, demo, and account pages.
          </p>

          <div className="mt-4 flex items-center justify-between rounded-xl border border-gray-200/70 bg-white/70 px-3 py-2.5 dark:border-gray-800/80 dark:bg-white/[0.02]">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                Appearance
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Theme: {theme === "dark" ? "Dark" : "Light"}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Switch Theme
            </button>
          </div>
        </div>

        <div className="w-full space-y-2">
          {settingsLinks.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="block w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
