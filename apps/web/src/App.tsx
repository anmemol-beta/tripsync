import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Camera,
  Check,
  CirclePlay,
  ExternalLink,
  Images,
  MessageCircle,
  QrCode,
  ReceiptText,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";
const TRIP_ID = "trip_tokyo_2026_05";

type ProposalOption = {
  id: string;
  label: string;
  detail: Record<string, unknown>;
};

type TripState = {
  trip: {
    _id: string;
    title: string;
    destination: string;
    start_date: string;
    end_date: string;
    status: "planning" | "active" | "ended";
    decisions: {
      hotel: ProposalOption | null;
      flight: ProposalOption | null;
      activities: ProposalOption[];
    };
  };
  members: Array<{
    user_handle: string;
    display_name: string;
    avatar_color: string;
  }>;
  messages: Array<{
    _id: string;
    author: string;
    body: string;
    created_at: string;
  }>;
  proposals: Array<{
    _id: string;
    kind: "hotel" | "flight" | "activity";
    prompt_summary: string;
    options: ProposalOption[];
    status: "open" | "decided" | "cancelled";
  }>;
  votes: Array<{
    proposal_id: string;
    voter: string;
    option_id: string;
  }>;
  history: Array<{
    _id: string;
    event_type: string;
    actor: string;
    created_at: string;
  }>;
  events: Array<{
    _id: string;
    title: string;
    starts_at: string;
    ends_at: string | null;
    location: string | null;
    status: "open" | "done" | "skipped";
  }>;
  tickets: Array<{
    _id: string;
    member_handle: string;
    type: string;
    vendor: string;
    amount: number;
    currency: string;
    pdf_url: string | null;
    qr_data: string | null;
    status: "parsing" | "parsed" | "failed";
    starts_at: string;
    ends_at: string | null;
  }>;
  expenses: Array<{
    _id: string;
    payer: string;
    amount: number;
    currency: string;
    description: string;
    split_among: string[];
    source: "text" | "receipt";
    receipt_url: string | null;
    status: "parsing" | "parsed" | "failed";
  }>;
  photos: Array<{
    _id: string;
    member_handle: string;
    url: string;
    taken_at: string;
    caption: string | null;
    place_name: string | null;
  }>;
  media_assets: Array<{
    _id: string;
    member_handle: string;
    kind: "video";
    original_name: string;
    file_url: string;
    duration_seconds: number | null;
    trim_start_seconds: number;
    trim_duration_seconds: number;
    caption: string | null;
    status: "uploaded" | "ready" | "failed";
  }>;
  settlement: {
    transfers: Array<{ from: string; to: string; amount: number; currency: string }>;
    totals_by_currency: Array<{ currency: string; amount: number }>;
  };
  video_jobs: Array<{
    _id: string;
    status: "brief_ready" | "rendering" | "ready" | "failed";
    duration_seconds: VideoDuration;
    title: string;
    narrative: string;
    scenes: Array<{ id: string; title: string; prompt: string; duration_seconds: number }>;
    output_url: string | null;
  }>;
  trip_memories: Array<{
    _id: string;
    title: string;
    rating: number;
    tags: string[];
    location: string;
  }>;
};

type ToolCall = { name: string };
type ToolStep = { name: string; status: "completed" | "failed" | "running"; summary: string };
type AppView = "trip" | "video" | "chat";
type FeaturePanel = "plans" | "tickets" | "split" | "photos";
type VideoDuration = 60 | 90 | 120;
type VideoSelection = {
  durationSeconds: VideoDuration;
  scenes: string[];
  photos: string[];
  events: string[];
  tickets: string[];
  settlement: boolean;
};

function App() {
  const [state, setState] = useState<TripState | null>(null);
  const [author, setAuthor] = useState("seo");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [activeView, setActiveView] = useState<AppView>("trip");
  const [activeFeature, setActiveFeature] = useState<FeaturePanel>("plans");
  const [videoSelection, setVideoSelection] = useState<VideoSelection>({
    durationSeconds: 60,
    scenes: [],
    photos: [],
    events: [],
    tickets: [],
    settlement: false,
  });
  const [selectionTripId, setSelectionTripId] = useState<string | null>(null);
  const [renderingJobId, setRenderingJobId] = useState<string | null>(null);
  const [recapState, setRecapState] = useState<"idle" | "loading" | "ready" | "playing">("idle");

  async function refresh() {
    const res = await fetch(`${API_BASE}/trip/${TRIP_ID}/state`);
    if (!res.ok) throw new Error(`state failed: ${res.status}`);
    const next = (await res.json()) as TripState;
    setState(next);
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(String(err)));
    const id = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!state || selectionTripId === state.trip._id) return;
    setVideoSelection({
      durationSeconds: state.video_jobs[0]?.duration_seconds ?? 60,
      scenes: state.video_jobs[0]?.scenes.map((scene) => scene.id) ?? [],
      photos: state.photos.slice(0, 6).map((photo) => photo._id),
      events: [],
      tickets: [],
      settlement: false,
    });
    setSelectionTripId(state.trip._id);
  }, [selectionTripId, state]);

  async function sendText(text: string) {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setToolSteps([{ name: "reasoning", status: "completed", summary: "agent turn started" }]);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip_id: TRIP_ID, author, text }),
      });
      if (!res.ok) throw new Error(`chat failed: ${res.status}`);
      const body = (await res.json()) as {
        reply?: string;
        tool_calls?: ToolCall[];
        tool_steps?: ToolStep[];
      };
      setToolSteps(
        body.tool_steps?.length
          ? body.tool_steps
          : (body.tool_calls ?? []).map((call) => ({
              name: call.name,
              status: "completed",
              summary: "completed",
            })),
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft;
    const file = uploadFile;
    setDraft("");
    setUploadFile(null);
    if (file) await uploadMedia(file, text);
    else await sendText(text);
  }

  async function uploadMedia(file: File, caption: string) {
    setBusy(true);
    setError(null);
    setToolSteps([{ name: "upload_video", status: "completed", summary: "saving video and selecting trim" }]);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("author", author);
      if (caption.trim()) form.set("caption", caption.trim());
      const res = await fetch(`${API_BASE}/trip/${TRIP_ID}/media`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
      await refresh();
      setActiveView("video");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function vote(proposalId: string, optionId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposal_id: proposalId, voter: author, option_id: optionId }),
      });
      if (!res.ok) throw new Error(`vote failed: ${res.status}`);
      setToolSteps([{ name: "append_vote", status: "completed", summary: "vote persisted" }]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function renderVideoJob(jobId: string, include?: VideoSelection) {
    setBusy(true);
    setRenderingJobId(jobId);
    setRecapState("loading");
    setError(null);
    setToolSteps([{ name: "render_video", status: "running", summary: "mixing real travel clips with music" }]);
    try {
      const res = await fetch(`${API_BASE}/video-jobs/${jobId}/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: include
          ? JSON.stringify({ duration_seconds: include.durationSeconds, include })
          : undefined,
      });
      if (!res.ok) throw new Error(`render failed: ${res.status}`);
      setToolSteps([{ name: "render_video", status: "completed", summary: "playable travel recap is ready" }]);
      await refresh();
      setRecapState("ready");
    } catch (err) {
      setToolSteps([{ name: "render_video", status: "failed", summary: "render failed" }]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setRenderingJobId(null);
    }
  }

  const openProposal = state?.proposals.find((proposal) => proposal.status === "open");
  const latestVideo = state?.video_jobs[0];
  const hasPlayableVideo = Boolean(latestVideo?.output_url?.match(/\/video\.(mp4|webm)$/));
  const isGeneratingVideo = Boolean(latestVideo && (renderingJobId === latestVideo._id || latestVideo.status === "rendering"));
  const activitySteps = busy ? runningActivity(toolSteps) : toolSteps;
  const nextEvent = state?.events.find((event) => event.status === "open");
  const firstTicket = state?.tickets.find((ticket) => ticket.qr_data);
  const firstTransfer = state?.settlement.transfers[0];
  const firstPhoto = state?.photos[0];
  const selectedCount =
    (state?.media_assets.length ?? 0) +
    videoSelection.scenes.length +
    videoSelection.photos.length;
  const memberName = useMemo(() => {
    const found = state?.members.find((member) => member.user_handle === author);
    return found?.display_name ?? author;
  }, [author, state?.members]);

  if (!state) {
    return (
      <main className="phone loading">
        <div className="phone-status" aria-hidden="true">
          <span>9:41</span>
          <span className="status-icons">5G</span>
        </div>
        <RefreshCw className="spin" size={18} />
        <span>Loading trip state</span>
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  return (
    <main className="phone">
      <div className="phone-status" aria-hidden="true">
        <span>9:41</span>
        <span className="status-icons">5G  82%</span>
      </div>

      <header className="topbar">
        <div>
          <p className="eyebrow">Trippo Agent</p>
          <h1>{state.trip.title}</h1>
          <span>{state.trip.destination} · {state.trip.start_date.slice(5)}-{state.trip.end_date.slice(5)}</span>
        </div>
        <div className="member-cluster">
          <div className="avatars" aria-label="Trip members">
            {state.members.map((member) => (
              <span
                key={member.user_handle}
                style={{ backgroundColor: member.avatar_color }}
                title={member.display_name}
              >
                {member.display_name.slice(0, 1)}
              </span>
            ))}
          </div>
          <select value={author} onChange={(event) => setAuthor(event.target.value)} aria-label="Current user">
            {state.members.map((member) => (
              <option key={member.user_handle} value={member.user_handle}>
                {member.display_name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <nav className="view-tabs" aria-label="App sections">
        <button className={activeView === "trip" ? "is-active" : ""} onClick={() => setActiveView("trip")}>
          <CalendarDays size={15} />
          <span>Trip</span>
        </button>
        <button className={activeView === "video" ? "is-active" : ""} onClick={() => setActiveView("video")}>
          <SlidersHorizontal size={15} />
          <span>Video</span>
        </button>
        <button className={activeView === "chat" ? "is-active" : ""} onClick={() => setActiveView("chat")}>
          <MessageCircle size={15} />
          <span>Chat</span>
        </button>
      </nav>

      <div className="phone-scroll">
        {activeView === "trip" && (
          <>
            <section className="status-band">
              <Decision label="Hotel" value={state.trip.decisions.hotel?.label} />
              <Decision label="Flight" value={state.trip.decisions.flight?.label} />
              <Decision label="Activities" value={`${state.trip.decisions.activities.length} picked`} />
            </section>

            <section className="artifact-rail" aria-label="Trippo artifacts">
              <ArtifactCard
                icon={<CalendarDays size={15} />}
                label="Next plan"
                title={nextEvent?.title ?? "No event yet"}
                meta={nextEvent ? shortDateTime(nextEvent.starts_at) : "Waiting"}
                detail={nextEvent?.location ?? `${state.events.length} events`}
                active={activeFeature === "plans"}
                onClick={() => setActiveFeature("plans")}
              />
              <ArtifactCard
                icon={<QrCode size={15} />}
                label="Ticket QR"
                title={firstTicket?.vendor ?? "No ticket yet"}
                meta={firstTicket ? `${firstTicket.type} · ${memberLabel(state, firstTicket.member_handle)}` : "Waiting"}
                detail={firstTicket?.qr_data ? "QR parsed" : `${state.tickets.length} tickets`}
                active={activeFeature === "tickets"}
                onClick={() => setActiveFeature("tickets")}
              />
              <ArtifactCard
                icon={<ReceiptText size={15} />}
                label="Split"
                title={
                  firstTransfer
                    ? `${memberLabel(state, firstTransfer.from)} -> ${memberLabel(state, firstTransfer.to)}`
                    : "No transfer"
                }
                meta={firstTransfer ? money(firstTransfer.amount, firstTransfer.currency) : "Settled"}
                detail={`${state.expenses.length} expenses`}
                active={activeFeature === "split"}
                onClick={() => setActiveFeature("split")}
              />
              <ArtifactCard
                icon={<Images size={15} />}
                label="Photos"
                title={firstPhoto?.place_name ?? "No photos yet"}
                meta={`${state.photos.length} synced`}
                detail={firstPhoto?.caption ?? "Used in recap"}
                active={activeFeature === "photos"}
                onClick={() => setActiveFeature("photos")}
              />
            </section>

            <FeatureDetail state={state} activeFeature={activeFeature} />

            <section className="memory-band" aria-label="Rated trip memories">
              <div className="section-head">
                <Sparkles size={15} />
                <h2>Rated memory</h2>
              </div>
              <div className="memory-list">
                {state.trip_memories.slice(0, 3).map((memory) => (
                  <article key={memory._id}>
                    <strong>{memory.title}</strong>
                    <span>{memory.rating}/5 · {memory.location}</span>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {activeView === "video" && (
          <>
            <section className={`video-band ${isGeneratingVideo ? "is-generating" : ""}`}>
              <div>
                <p className="eyebrow">Video studio</p>
                <h2>{latestVideo ? latestVideo.title : "Travel video brief"}</h2>
                <p>{latestVideo ? `${selectedCount} travel clips, scenes, and photo cuts selected for a ${videoSelection.durationSeconds}s render.` : "Create a brief first, then choose what goes into the video."}</p>
              </div>
              {latestVideo ? (
                <div className="video-actions">
                  <span className={`pill ${isGeneratingVideo ? "rendering" : latestVideo.status}`}>
                    {isGeneratingVideo ? "generating" : latestVideo.status.replace("_", " ")}
                  </span>
                  <button
                    className={`icon-button ${isGeneratingVideo ? "is-busy" : ""}`}
                    onClick={() => renderVideoJob(latestVideo._id, videoSelection)}
                    disabled={busy || isGeneratingVideo}
                    aria-label="Generate travel video"
                    title="Generate travel video"
                  >
                    {isGeneratingVideo ? <RefreshCw className="spin" size={18} /> : <CirclePlay size={18} />}
                  </button>
                  {latestVideo.status === "ready" && latestVideo.output_url && hasPlayableVideo && (
                    <a
                      className="icon-button"
                      href={latestVideo.output_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open playable video"
                      title="Open playable video"
                    >
                      <ExternalLink size={18} />
                    </a>
                  )}
                </div>
              ) : (
                <button
                  className="icon-button"
                  onClick={() =>
                    sendText(
                      `Create a ${videoSelection.durationSeconds}-second vertical travel video brief from the uploaded travel clips and chat highlights.`,
                    )
                  }
                  disabled={busy}
                  aria-label="Create travel video brief"
                  title="Create travel video brief"
                >
                  <CirclePlay size={18} />
                </button>
              )}
            </section>

            {latestVideo && (
              <section className={`generation-panel ${isGeneratingVideo ? "is-active" : hasPlayableVideo ? "is-ready" : ""}`}>
                <div className="generation-orbit" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div>
                  <strong>
                    {isGeneratingVideo
                      ? "Generating travel recap"
                      : hasPlayableVideo
                        ? "Travel recap ready"
                        : "Ready to generate"}
                  </strong>
                  <span>
                    {isGeneratingVideo
                      ? "Using the uploaded travel clips first, then adding quick photo cuts and music."
                      : hasPlayableVideo
                        ? `${recapState === "playing" ? "Playing" : "Playable"} ${videoSelection.durationSeconds}-second video is available below.`
                        : `Tap the play button to render the ${videoSelection.durationSeconds}-second travel video.`}
                  </span>
                </div>
              </section>
            )}

            {latestVideo && (
              <VideoStudio
                state={state}
                latestVideo={latestVideo}
                selection={videoSelection}
                onChange={setVideoSelection}
              />
            )}

            {state.media_assets.length > 0 && (
              <section className="clip-panel">
                <div className="section-head">
                  <Camera size={15} />
                  <h2>Uploaded clips</h2>
                </div>
                <div className="clip-list">
                  {state.media_assets.map((asset) => (
                    <article key={asset._id}>
                      <video src={asset.file_url} muted playsInline preload="metadata" />
                      <div>
                        <strong>{asset.caption || asset.original_name}</strong>
                        <span>{memberLabel(state, asset.member_handle)} · trim {formatSeconds(asset.trim_start_seconds)} to {formatSeconds(asset.trim_start_seconds + asset.trim_duration_seconds)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {latestVideo?.output_url && hasPlayableVideo && (
              <video
                className="recap-player"
                src={latestVideo.output_url}
                controls
                playsInline
                preload="metadata"
                onLoadStart={() => setRecapState("loading")}
                onCanPlay={() => setRecapState("ready")}
                onPlay={() => setRecapState("playing")}
                onPause={() => setRecapState("ready")}
              />
            )}

            <section className="trace" aria-label="Agent activity">
              <div className="section-head">
                <Sparkles size={15} />
                <h2>Agent activity</h2>
              </div>
              <div className="step-list">
                {(activitySteps.length ? activitySteps : [{ name: "waiting", status: "completed" as const, summary: latestHistoryLabel(state) }]).map(
                  (step, index) => (
                    <article key={`${step.name}-${index}`} className={`step ${step.status}`}>
                      <StepIcon status={busy && index === activitySteps.length - 1 ? "running" : step.status} />
                      <div>
                        <strong>{toolLabel(step.name)}</strong>
                        <span>{step.summary}</span>
                      </div>
                    </article>
                  ),
                )}
              </div>
            </section>
          </>
        )}

        {openProposal && (
          <section className="proposal">
            <div className="proposal-head">
              <Sparkles size={16} />
              <div>
                <h2>{openProposal.kind} proposal</h2>
                <p>{openProposal.prompt_summary}</p>
              </div>
            </div>
            <div className="option-list">
              {openProposal.options.map((option) => (
                <button
                  key={option.id}
                  className="option"
                  onClick={() => vote(openProposal._id, option.id)}
                  disabled={busy}
                >
                  <span>{option.label}</span>
                  <small>{voteCount(state, openProposal._id, option.id)} votes</small>
                </button>
              ))}
            </div>
          </section>
        )}

        {activeView === "chat" && (
          <>
            <section className="thread" aria-label="Trip chat">
              {state.messages.map((message) => (
                <article
                  key={message._id}
                  className={`message ${message.author === "agent" ? "agent" : message.author === author ? "me" : ""}`}
                >
                  <span>{message.author === author ? memberName : message.author}</span>
                  <MessageBody text={message.body} />
                </article>
              ))}
            </section>
            <form className="composer inline-composer" onSubmit={handleSubmit}>
              <label className={`attach-button ${uploadFile ? "has-file" : ""}`} title="Attach video">
                <Upload size={17} />
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/*"
                  onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                  disabled={busy}
                />
              </label>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={uploadFile ? uploadFile.name : "Ask the agent..."}
                disabled={busy}
              />
              <button disabled={busy || (!draft.trim() && !uploadFile)} aria-label="Send" title="Send">
                <Send size={18} />
              </button>
            </form>
          </>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}

function Decision({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value ?? "Open"}</strong>
    </div>
  );
}

function MessageBody({ text }: { text: string }) {
  const lines = text
    .replace(/\*\*/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return <p>{text.replace(/\*\*/g, "")}</p>;

  return (
    <div className="message-body">
      {lines.map((line, index) => {
        const numbered = line.match(/^(\d+)\.\s*(.+)$/);
        const bullet = line.match(/^[-*]\s*(.+)$/);
        if (numbered) {
          return (
            <div key={`${line}-${index}`} className="msg-row numbered">
              <b>{numbered[1]}</b>
              <span>{numbered[2]}</span>
            </div>
          );
        }
        if (bullet) {
          return (
            <div key={`${line}-${index}`} className="msg-row bullet">
              <i />
              <span>{bullet[1]}</span>
            </div>
          );
        }
        return index === 0 ? <strong key={line} className="msg-title">{line}</strong> : <p key={`${line}-${index}`}>{line}</p>;
      })}
    </div>
  );
}

function StepIcon({ status }: { status: "completed" | "failed" | "running" }) {
  if (status === "running") return <RefreshCw className="spin" size={14} />;
  if (status === "failed") return <X size={14} />;
  return <Check size={14} />;
}

function runningActivity(steps: ToolStep[]): ToolStep[] {
  const base = steps.length ? steps : [{ name: "reasoning", status: "completed" as const, summary: "planning next tool" }];
  return [...base, { name: "mongodb_mcp", status: "completed", summary: "reading/writing shared memory" }];
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    reasoning: "Reasoning",
    mongodb_mcp: "MongoDB MCP",
    find_trip: "Load trip",
    list_members: "Load members",
    search_semantic_memories: "Vector memory search",
    search_hotels: "Hotel search",
    search_flights: "Flight search",
    search_activities: "Activity search",
    insert_proposal: "Save proposal",
    append_vote: "Save vote",
    tally_votes: "Tally votes",
    update_trip_decision: "Save decision",
    append_history: "Append history",
    create_travel_video: "Create video brief",
    render_video: "Render recap",
    upload_video: "Upload video",
    waiting: "Waiting",
  };
  return labels[name] ?? name;
}

function ArtifactCard({
  icon,
  label,
  title,
  meta,
  detail,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  meta: string;
  detail: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`artifact-card ${active ? "is-active" : ""}`} onClick={onClick}>
      <div>
        {icon}
        <span>{label}</span>
      </div>
      <strong>{title}</strong>
      <small>{meta}</small>
      <p>{detail}</p>
    </button>
  );
}

function FeatureDetail({ state, activeFeature }: { state: TripState; activeFeature: FeaturePanel }) {
  if (activeFeature === "plans") {
    return (
      <section className="detail-panel">
        <div className="section-head">
          <CalendarDays size={15} />
          <h2>Next plan</h2>
        </div>
        <div className="detail-list">
          {state.events.map((event) => (
            <article key={event._id}>
              <strong>{event.title}</strong>
              <span>{shortDateTime(event.starts_at)} · {event.location ?? "Location TBD"}</span>
              <small>{event.status}</small>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (activeFeature === "tickets") {
    return (
      <section className="detail-panel">
        <div className="section-head">
          <QrCode size={15} />
          <h2>Ticket QR</h2>
        </div>
        <div className="detail-list">
          {state.tickets.map((ticket) => (
            <article key={ticket._id}>
              <strong>{ticket.vendor}</strong>
              <span>{ticket.type} · {memberLabel(state, ticket.member_handle)} · {shortDateTime(ticket.starts_at)}</span>
              <code>{ticket.qr_data ?? "QR pending"}</code>
              {ticket.pdf_url && (
                <a href={ticket.pdf_url} target="_blank" rel="noreferrer">
                  Open ticket PDF
                </a>
              )}
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (activeFeature === "split") {
    return (
      <section className="detail-panel">
        <div className="section-head">
          <ReceiptText size={15} />
          <h2>Split</h2>
        </div>
        <div className="summary-row">
          {state.settlement.totals_by_currency.map((total) => (
            <strong key={total.currency}>{money(total.amount, total.currency)}</strong>
          ))}
        </div>
        <div className="detail-list">
          {state.settlement.transfers.map((transfer) => (
            <article key={`${transfer.from}-${transfer.to}-${transfer.amount}`}>
              <strong>{memberLabel(state, transfer.from)} pays {memberLabel(state, transfer.to)}</strong>
              <span>{money(transfer.amount, transfer.currency)}</span>
            </article>
          ))}
          {state.expenses.map((expense) => (
            <article key={expense._id}>
              <strong>{expense.description}</strong>
              <span>{memberLabel(state, expense.payer)} paid {money(expense.amount, expense.currency)} · split {expense.split_among.length} ways</span>
              {expense.receipt_url && (
                <a href={expense.receipt_url} target="_blank" rel="noreferrer">
                  Open receipt image
                </a>
              )}
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="detail-panel">
      <div className="section-head">
        <Images size={15} />
        <h2>Photos</h2>
      </div>
      <div className="photo-grid">
        {state.photos.map((photo) => (
          <article key={photo._id}>
            <img src={photo.url} alt="" />
            <strong>{photo.place_name ?? memberLabel(state, photo.member_handle)}</strong>
            <span>{photo.caption ?? shortDateTime(photo.taken_at)}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function VideoStudio({
  state,
  latestVideo,
  selection,
  onChange,
}: {
  state: TripState;
  latestVideo: TripState["video_jobs"][number];
  selection: VideoSelection;
  onChange: (selection: VideoSelection) => void;
}) {
  return (
    <section className="studio-panel">
      <div className="section-head">
        <SlidersHorizontal size={15} />
        <h2>{selection.durationSeconds}s render mix</h2>
      </div>
      <div className="duration-control" aria-label="Video duration">
        {([60, 90, 120] as const).map((duration) => (
          <button
            key={duration}
            type="button"
            className={selection.durationSeconds === duration ? "is-active" : ""}
            onClick={() => onChange({ ...selection, durationSeconds: duration })}
          >
            {duration}s
          </button>
        ))}
      </div>
      <ToggleGroup
        title="Scenes"
        items={latestVideo.scenes.map((scene) => ({
          id: scene.id,
          title: scene.title,
          meta: `${scene.duration_seconds}s`,
        }))}
        selected={selection.scenes}
        onToggle={(id) => onChange({ ...selection, scenes: toggleId(selection.scenes, id) })}
      />
      <ToggleGroup
        title="Photos"
        items={state.photos.slice(0, 8).map((photo) => ({
          id: photo._id,
          title: photo.place_name ?? photo.caption ?? "Trip photo",
          meta: memberLabel(state, photo.member_handle),
        }))}
        selected={selection.photos}
        onToggle={(id) => onChange({ ...selection, photos: toggleId(selection.photos, id) })}
      />
    </section>
  );
}

function ToggleGroup({
  title,
  items,
  selected,
  onToggle,
}: {
  title: string;
  items: Array<{ id: string; title: string; meta: string }>;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="toggle-group">
      <h3>{title}</h3>
      <div>
        {items.map((item) => (
          <label key={item.id} className="check-row">
            <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />
            <span>{item.title}</span>
            <small>{item.meta}</small>
          </label>
        ))}
      </div>
    </div>
  );
}

function toggleId(values: string[], id: string): string[] {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

function shortDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function memberLabel(state: TripState, handle: string): string {
  return state.members.find((member) => member.user_handle === handle)?.display_name ?? handle;
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatSeconds(value: number): string {
  return `${Number(value.toFixed(1))}s`;
}

function voteCount(state: TripState, proposalId: string, optionId: string): number {
  return state.votes.filter((voteRow) => voteRow.proposal_id === proposalId && voteRow.option_id === optionId)
    .length;
}

function latestHistoryLabel(state: TripState): string {
  const latest = state.history[0];
  return latest ? `${latest.event_type} by ${latest.actor}` : "waiting for agent tools";
}

export default App;
