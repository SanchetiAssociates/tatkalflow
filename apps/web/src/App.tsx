import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { createBrowserRouter, Outlet, RouterProvider, ScrollRestoration } from "react-router";
import { AppShell } from "./components/app/AppShell";
import { PublicOnly, RequireAuth } from "./components/app/guards";
import { ErrorState, Spinner } from "./components/ui";
import { ApiError, SessionExpiredError } from "./lib/api";
import { AuthProvider } from "./lib/auth";

// Route-level code splitting.
const Welcome = lazy(() => import("./features/onboarding/Welcome"));
const Login = lazy(() => import("./features/auth/Login"));
const VerifyOtp = lazy(() => import("./features/auth/VerifyOtp"));
const AccountReady = lazy(() => import("./features/onboarding/AccountReady"));
const FirstPassenger = lazy(() => import("./features/onboarding/FirstPassenger"));
const FirstJourney = lazy(() => import("./features/onboarding/FirstJourney"));
const Home = lazy(() => import("./features/home/Home"));
const Trips = lazy(() => import("./features/journeys/Trips"));
const NewTrip = lazy(() => import("./features/journeys/NewTrip"));
const Passengers = lazy(() => import("./features/passengers/Passengers"));
const PassengerEditor = lazy(() => import("./features/passengers/PassengerEditor"));
const Bookings = lazy(() => import("./features/bookings/Bookings"));
const Profile = lazy(() => import("./features/profile/Profile"));

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, err) => !(err instanceof SessionExpiredError) && !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  });
}

function RouteError() {
  return (
    <div className="mx-auto max-w-md p-6">
      <ErrorState message="This screen couldn't load. Your saved details are safe." onRetry={() => window.location.reload()} />
    </div>
  );
}

function Bare() {
  return (
    <main id="main" className="pt-safe-8 mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8">
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
    </main>
  );
}

function Root() {
  return (
    <>
      {/* New screens start at the top; back/forward restores position. */}
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

export const routes = [
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      {
        element: (
          <PublicOnly>
            <Bare />
          </PublicOnly>
        ),
        children: [
          { path: "/welcome", element: <Welcome /> },
          { path: "/login", element: <Login /> },
          { path: "/login/verify", element: <VerifyOtp /> },
        ],
      },
      {
        element: (
          <RequireAuth>
            <Bare />
          </RequireAuth>
        ),
        children: [
          { path: "/onboarding/ready", element: <AccountReady /> },
          { path: "/onboarding/passenger", element: <FirstPassenger /> },
          { path: "/onboarding/journey", element: <FirstJourney /> },
        ],
      },
      {
        element: (
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        ),
        children: [
          { path: "/", element: <Home /> },
          { path: "/trips", element: <Trips /> },
          { path: "/trips/new", element: <NewTrip /> },
          { path: "/passengers", element: <Passengers /> },
          { path: "/passengers/new", element: <PassengerEditor /> },
          { path: "/passengers/:id/edit", element: <PassengerEditor /> },
          { path: "/bookings", element: <Bookings /> },
          { path: "/profile", element: <Profile /> },
          { path: "*", element: <ErrorState message="Page not found." /> },
        ],
      },
    ],
  },
];

export default function App() {
  const router = createBrowserRouter(routes);
  return (
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
