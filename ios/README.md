# Tacit for iPhone

The iPhone app is the Tacit web app (`apps/tacit`) inside a native shell that gives it a voice:
speech recognition for what you say (on the iPhone when it can) and speech for what Tacit says.
All of Tacit's logic stays in the page, so the web app and the iPhone app cannot drift apart.

## First build (on a Mac)

```sh
brew install xcodegen          # once
cd ios && xcodegen             # writes Tacit.xcodeproj
open Tacit.xcodeproj
```

In Xcode: choose your team under Signing & Capabilities, plug in the iPhone, press Run.
The build runs `npm run build:tacit` first, so the page in the app is always the current one.

## How the voice works

- Tap the microphone to talk. Your words appear live as you speak; a 1.4-second pause ends your turn.
- Long-press the microphone for hands-free: after Tacit answers, it listens again on its own. Tap to end it.
- Tacit never listens while it is speaking, so it cannot hear and answer itself.

## Not in this build yet

- Sign in with Apple, and sync. What Tacit learns stays on this iPhone.
- Push notifications for "your briefing is ready".
- The server's World Monitor feed: the app uses the labelled sample world until the server is deployed.

None of this has been compiled yet: it was written without a Mac. Expect the first build to need small fixes.
