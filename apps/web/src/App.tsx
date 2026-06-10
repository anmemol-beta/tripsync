import { FormEvent, useEffect, useMemo, useState } from "react";
import { Camera, Check, CirclePlay, RefreshCw, Send, Sparkles, X } from "lucide-react";

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
  video_jobs: Array<{
    _id: string;
    status: "brief_ready" | "rendering" | "ready" | "failed";
    duration_seconds: 60 | 180 | 300;
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
type ToolStep = { name: string; status: "completed" | "failed"; summary: string };

function App() {
  const [state, setState] = useState<TripState | null>(null);
  const [author, setAuthor] = useState("seo");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);

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
    setDraft("");
    await sendText(text);
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

  const openProposal = state?.proposals.find((proposal) => proposal.status === "open");
  const latestVideo = state?.video_jobs[0];
  const activitySteps = busy ? runningActivity(toolSteps) : toolSteps;
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

      <div className="phone-scroll">
        <section className="status-band">
          <Decision label="Hotel" value={state.trip.decisions.hotel?.label} />
          <Decision label="Flight" value={state.trip.decisions.flight?.label} />
          <Decision label="Activities" value={`${state.trip.decisions.activities.length} picked`} />
        </section>

        <section className="video-band">
          <div>
            <p className="eyebrow">Core output</p>
            <h2>{latestVideo ? latestVideo.title : "Travel video brief"}</h2>
            <p>{latestVideo ? latestVideo.narrative : "Agent turns the trip state into a vertical recap video plan."}</p>
          </div>
          {latestVideo ? (
            <span className={`pill ${latestVideo.status}`}>{latestVideo.status.replace("_", " ")}</span>
          ) : (
            <button
              className="icon-button"
              onClick={() =>
                sendText(
                  "결정된 일정, 투표 이유, 대화 하이라이트를 바탕으로 60초 세로 여행영상 브리프를 만들어줘.",
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
          <section className="scene-strip" aria-label="Video scenes">
            {latestVideo.scenes.map((scene) => (
              <article key={scene.id}>
                <Camera size={14} />
                <strong>{scene.title}</strong>
                <span>{scene.duration_seconds}s</span>
              </article>
            ))}
          </section>
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

        <section className="thread" aria-label="Trip chat">
          {state.messages.slice(-10).map((message) => (
            <article
              key={message._id}
              className={`message ${message.author === "agent" ? "agent" : message.author === author ? "me" : ""}`}
            >
              <span>{message.author === author ? memberName : message.author}</span>
              <MessageBody text={message.body} />
            </article>
          ))}
        </section>

        {error && <p className="error">{error}</p>}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask the agent..."
          disabled={busy}
        />
        <button disabled={busy || !draft.trim()} aria-label="Send" title="Send">
          <Send size={18} />
        </button>
      </form>
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
    waiting: "Waiting",
  };
  return labels[name] ?? name;
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
