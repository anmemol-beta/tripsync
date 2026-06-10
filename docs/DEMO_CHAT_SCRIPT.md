# Demo Chat Script

This is the concrete chat run for the 3-minute hackathon demo. It must show the features we already have, with Seo, Jamie, and Min participating evenly.

## Feature Coverage

| Feature | How the demo shows it |
|---|---|
| Real mobile app UI | Right cmux browser panel shows the phone-framed React app. |
| Gemini agent tool use | Agent Activity timeline shows tool steps after each `/chat` turn. |
| MongoDB MCP memory | `find_trip`, proposal writes, votes, history, and `video_jobs` persist to Atlas. |
| Atlas Vector Search | `search_semantic_memories` retrieves high-rated trip memories. |
| Rating-based preference | Agent recommends quiet/cinematic Tokyo routes from 5/5 memories. |
| Human group planning | Seo, Jamie, and Min each speak or vote. |
| Voting | All three members cast votes; result is tallied before the decision is saved. |
| Final video artifact | Agent creates a 60-second vertical travel-video brief in `video_jobs`. |

## Chat Run

1. Seo starts planning:
   `우리 도쿄 5/26-5/30 갈건데 시부야 근처 호텔 추천해줘. 예산 1박 15만원.`

   Expected tools: `find_trip`, `search_hotels`, `insert_proposal`, `append_history`.

2. Jamie responds as a friend:
   `나는 역에서 가까운 곳이면 좋아. 밤에 이동 편한 게 제일 중요해.`

   Expected behavior: normal message persistence. If Gemini acts, it should reference group preference, not decide.

3. Min adds a different preference:
   `나는 조용한 쪽이 좋아. 너무 번잡한 호텔은 피하고 싶어.`

   Expected behavior: normal message persistence. This makes the group feel real before voting.

4. Votes:
   - Seo votes for one hotel.
   - Jamie votes for the most transit-friendly hotel.
   - Min votes for the quieter option.

   Expected tools through `/vote`: `append_vote` three times.

5. Seo asks to close the decision:
   `이제 투표 결과 보고 호텔 결정해줘.`

   Expected tools: `tally_votes`, `update_trip_decision`, `append_history`.

6. Jamie asks for taste-based planning:
   `예전에 우리가 좋아했던 분위기 기준으로, 사람 너무 많지 않고 영상 예쁘게 나오는 루트 추천해줘.`

   Expected tools: `search_semantic_memories`, optionally `append_history`.
   Expected UI evidence: `4 rated memories retrieved`.

7. Min asks for the final video:
   `그 루트랑 지금까지 대화, 투표 이유까지 합쳐서 60초 세로 여행영상 브리프 만들어줘.`

   Expected tools: `find_trip`, `search_semantic_memories`, `create_travel_video`, `append_history`.
   Expected persisted result: new `video_jobs` document with `status: "brief_ready"`.

## Video Renderer Follow-Up

The rendering adapter should follow the MindStudio Trippo recap approach from `travel-summary-app`:

- Build a 1080x1920 HTML recap from selected segments.
- Keep each render chunk under 30 seconds.
- Render chunks through the existing MindStudio-style asset pipeline or equivalent adapter.
- Merge chunks into one vertical MP4.
- Store `output_url`, `recap_render_id`, failure stage, and timestamps back into MongoDB.

Reference files:

- `/Users/hunjunsin/Desktop/travel/travel-summary-app/scripts/probe-real-recap-boston.mjs`
- `/Users/hunjunsin/Desktop/travel/travel-summary-app/scripts/probe-real-recap-snappy.mjs`
- `/Users/hunjunsin/Desktop/travel/travel-summary-app/docs/schema.md`
- `/Users/hunjunsin/Desktop/travel/travel-summary-app/notes/mobile-audit.md`
