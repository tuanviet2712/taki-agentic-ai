import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AdsLayout } from "./components/AdsLayout";
import { Layout } from "./components/Layout";
import { AssistantPanel } from "./components/AssistantPanel";
import { AgentDialoguePanel } from "./components/AgentDialoguePanel";
import { ToastProvider } from "./components/ui";
import { Overview } from "./pages/Overview";
import { Brain } from "./pages/Brain";
import { Dna } from "./pages/Dna";
import { Plan } from "./pages/Plan";
import { Agents } from "./pages/Agents";
import { Content } from "./pages/Content";
import { Publish } from "./pages/Publish";
import { Ads } from "./pages/Ads";
import { Chat } from "./pages/Chat";
import { SalesFlow } from "./pages/SalesFlow";
import { Reports } from "./pages/Reports";
import { Approvals } from "./pages/Approvals";
import { Knowledge } from "./pages/Knowledge";
import { Jev } from "./pages/Jev";
import { Settings } from "./pages/Settings";
import { Skills } from "./pages/Skills";
import { VideoFlow } from "./pages/VideoFlow";
import { Connections } from "./pages/Connections";
import { Automations } from "./pages/Automations";
import { QuickAd } from "./pages/QuickAd";
import { AdTemplates } from "./pages/AdTemplates";
import { Mcp, McpNewKey } from "./pages/Mcp";
import { AdsSetup } from "./pages/AdsSetup";
import { AdsHelp } from "./pages/AdsHelp";
import { ZaloFollowUp } from "./pages/ZaloFollowUp";
import { EmailPage } from "./pages/Email";
import { Orchestra } from "./pages/Orchestra";
import { Logs } from "./pages/Logs";
import { Channels } from "./pages/Channels";
import { AdsReports } from "./pages/AdsReports";
import { Scout } from "./pages/Scout";
import { Nurture } from "./pages/Nurture";
import { Autopilot } from "./pages/Autopilot";
import { Debate } from "./pages/Debate";

/** Redirect keeping the query string (e.g. ?type=…, ?p=…). */
function Keep({ to }: { to: string }) {
  const loc = useLocation();
  return <Navigate to={`${to}${loc.search}`} replace />;
}
function Shell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  return (
    <>
      {loc.pathname.startsWith("/ads") ? <AdsLayout>{children}</AdsLayout> : <Layout>{children}</Layout>}
      <AgentDialoguePanel />
      <AssistantPanel />
    </>
  );
}

export function App() {
  return (
    <ToastProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/brain" element={<Brain />} />
          <Route path="/dna" element={<Dna />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/autopilot" element={<Autopilot />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/debate" element={<Debate />} />
          <Route path="/content" element={<Content />} />
          <Route path="/publish" element={<Publish />} />
          <Route path="/channels" element={<Channels />} />
          <Route path="/nurture" element={<Nurture />} />
          <Route path="/scout" element={<Scout />} />
          <Route path="/research" element={<Navigate to="/scout" replace />} />
          {/* AI Agent Ads workspace (own layout, see AdsLayout) */}
          <Route path="/ads" element={<Navigate to="/ads/flows?type=metrics_pull" replace />} />
          <Route path="/ads/setup" element={<AdsSetup />} />
          <Route path="/ads/flows" element={<Automations />} />
          <Route path="/ads/quick" element={<QuickAd />} />
          <Route path="/ads/library" element={<AdTemplates />} />
          <Route path="/ads/integrations" element={<Connections />} />
          <Route path="/ads/stats" element={<Ads />} />
          <Route path="/ads/reports" element={<AdsReports />} />
          <Route path="/ads/logs" element={<Logs />} />
          <Route path="/ads/ai-gateway" element={<Mcp />} />
          <Route path="/ads/ai-gateway/new" element={<McpNewKey />} />
          <Route path="/ads/help" element={<AdsHelp />} />
          {/* old paths */}
          <Route path="/ads/automation" element={<Keep to="/ads/flows" />} />
          <Route path="/ads/templates" element={<Navigate to="/ads/library" replace />} />
          <Route path="/connections" element={<Keep to="/ads/integrations" />} />
          <Route path="/mcp" element={<Navigate to="/ads/ai-gateway" replace />} />
          <Route path="/logs" element={<Navigate to="/ads/logs" replace />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/sales-flow" element={<SalesFlow />} />
          <Route path="/zalo" element={<ZaloFollowUp />} />
          <Route path="/email" element={<EmailPage />} />
          <Route path="/orchestra" element={<Orchestra />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/jev" element={<Jev />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/video-flow" element={<VideoFlow />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Shell>
    </ToastProvider>
  );
}
