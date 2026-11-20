import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./lib/api.js";
import LoginPage from "./pages/LoginPage.js";
import Layout from "./components/Layout.js";
import CallsPage from "./pages/CallsPage.js";
import ForwardingPage from "./pages/ForwardingPage.js";
import RawDeliveriesPage from "./pages/RawDeliveriesPage.js";
import AttributionPage from "./pages/AttributionPage.js";

export type Tab = "calls" | "forwarding" | "raw-deliveries" | "attribution";

export default function App() {
  const [tab, setTab] = useState<Tab>("calls");
  const meQuery = useQuery({ queryKey: ["me"], queryFn: api.me });

  if (meQuery.isLoading) return null;

  if (!meQuery.data?.authenticated) {
    return <LoginPage onLoggedIn={() => meQuery.refetch()} />;
  }

  return (
    <Layout
      activeTab={tab}
      onTabChange={setTab}
      onLogout={async () => {
        await api.logout();
        meQuery.refetch();
      }}
    >
      {tab === "calls" && <CallsPage />}
      {tab === "forwarding" && <ForwardingPage />}
      {tab === "raw-deliveries" && <RawDeliveriesPage />}
      {tab === "attribution" && <AttributionPage />}
    </Layout>
  );
}
