import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router";
import AppLayout from "./layout/AppLayout";
import { ScrollToTop } from "./components/common/ScrollToTop";

const Home = lazy(() => import("./pages/Signal"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const Intel = lazy(() => import("./pages/Intel"));
const UserProfiles = lazy(() => import("./pages/UserProfiles"));
const Calendar = lazy(() => import("./pages/Calendar"));
const Blank = lazy(() => import("./pages/Blank"));
const FormElements = lazy(() => import("./pages/Forms/FormElements"));
const BasicTables = lazy(() => import("./pages/Tables/BasicTables"));
const Alerts = lazy(() => import("./pages/UiElements/Alerts"));
const Avatars = lazy(() => import("./pages/UiElements/Avatars"));
const Badges = lazy(() => import("./pages/UiElements/Badges"));
const Buttons = lazy(() => import("./pages/UiElements/Buttons"));
const Images = lazy(() => import("./pages/UiElements/Images"));
const Videos = lazy(() => import("./pages/UiElements/Videos"));
const LineChart = lazy(() => import("./pages/Charts/LineChart"));
const BarChart = lazy(() => import("./pages/Charts/BarChart"));
const SignIn = lazy(() => import("./pages/AuthPages/SignIn"));
const SignUp = lazy(() => import("./pages/AuthPages/SignUp"));
const NotFound = lazy(() => import("./pages/OtherPage/NotFound"));
const Settings = lazy(() => import("./pages/Settings"));

export default function App() {
  return (
    <Router>
      <ScrollToTop />
      <Suspense fallback={<div className="min-h-screen bg-white dark:bg-gray-900" />}>
        <Routes>
          {/* Dashboard Layout */}
          <Route element={<AppLayout />}>
            <Route index path="/" element={<Home />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/intel" element={<Intel />} />

            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/profile" element={<UserProfiles />} />
            <Route path="/settings/calendar" element={<Calendar />} />
            <Route path="/settings/blank" element={<Blank />} />
            <Route path="/settings/form-elements" element={<FormElements />} />
            <Route path="/settings/basic-tables" element={<BasicTables />} />
            <Route path="/settings/alerts" element={<Alerts />} />
            <Route path="/settings/avatars" element={<Avatars />} />
            <Route path="/settings/badge" element={<Badges />} />
            <Route path="/settings/buttons" element={<Buttons />} />
            <Route path="/settings/images" element={<Images />} />
            <Route path="/settings/videos" element={<Videos />} />
            <Route path="/settings/line-chart" element={<LineChart />} />
            <Route path="/settings/bar-chart" element={<BarChart />} />
            <Route path="/settings/error-404" element={<NotFound />} />
          </Route>

          {/* Auth Layout */}
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />

          {/* Fallback Route */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Router>
  );
}
