import { Link, useLocation } from "react-router";

function SignalIcon() {
  return (
    <span
      className="material-symbols-outlined text-[20px] leading-none"
      style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
      aria-hidden="true"
    >
      bolt
    </span>
  );
}

function PortfolioIcon() {
  return (
    <span
      className="material-symbols-outlined text-[20px] leading-none"
      style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
      aria-hidden="true"
    >
      account_balance_wallet
    </span>
  );
}

function IntelIcon() {
  return (
    <span
      className="material-symbols-outlined text-[20px] leading-none"
      style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
      aria-hidden="true"
    >
      network_intel_node
    </span>
  );
}

function SettingsIcon() {
  return (
    <span
      className="material-symbols-outlined text-[20px] leading-none"
      style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
      aria-hidden="true"
    >
      settings
    </span>
  );
}

type NavItem = {
  label: string;
  path: string;
  icon: React.ReactNode;
};

const navItems: NavItem[] = [
  { label: "Signal", path: "/", icon: <SignalIcon /> },
  { label: "Portfolio", path: "/portfolio", icon: <PortfolioIcon /> },
  { label: "Intel", path: "/intel", icon: <IntelIcon /> },
  { label: "Settings", path: "/settings", icon: <SettingsIcon /> },
];

const BottomNav: React.FC = () => {
  const location = useLocation();

  return (
    <nav className="app-nav-texture fixed bottom-0 left-0 right-0 z-50 border-t border-gray-300/70 dark:border-gray-700/70">
      <div className="mx-auto grid w-full max-w-screen-sm grid-cols-4 gap-1 px-2 py-2">
        {navItems.map((item) => {
          const isActive =
            item.path === "/"
              ? location.pathname === "/"
              : location.pathname === item.path ||
                location.pathname.startsWith(`${item.path}/`);

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`group flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-center transition-all duration-200 ${
                isActive
                  ? "text-[#FFD300] dark:text-[#FFD300]"
                  : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              }`}
            >
              <span className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                isActive
                  ? "bg-transparent"
                  : "bg-transparent"
              }`}>
                {item.icon}
              </span>
              <span className="text-[10px] font-medium leading-none tracking-[0.01em]">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
