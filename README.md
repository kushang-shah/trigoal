# TriGoal

3-player top-down car soccer in the browser. Node.js + Express + Socket.IO backend, plain HTML/CSS/JS canvas frontend.

- Create a room, share the 4-letter code (max 3 players, host can start with 2)
- Drive: WASD / arrows. Boost: Space / Shift. Mute: M. Touch controls on phones.
- Defend your goal, score in the others. First to 5 wins.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
```

Fill empty seats with bots for testing: `node tools/bots.js ROOMCODE 2`

## Deploy (Render, free)

Push to GitHub, then on render.com choose **New → Blueprint** and select the repo. `render.yaml` configures a free Node web service. Free instances sleep after ~15 min idle and take ~30–60s to wake.
