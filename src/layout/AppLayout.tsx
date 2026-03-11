import { Outlet } from "react-router";
import BottomNav from "./BottomNav";

const AppLayout: React.FC = () => {
  return (
    <div className="app-surface-texture min-h-screen">
      <main className="mx-auto w-full max-w-screen-sm px-4 pb-24 pt-4 sm:px-5">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
};

export default AppLayout;
