# FQ-41 Gate 1 - Product

## The user problem

Sometimes a person starts a session, sees "Listening", speaks, and is never heard. Nothing on
screen says anything is wrong. They wait, repeat themselves, and eventually give up or
reload without knowing why.

This happened twice in about a dozen session starts during testing on 2026-11-14. It is
intermittent, so the person cannot tell whether it is their microphone, their browser or
the app.

The cause is that part of the app's ability to hear speech is fetched from an outside
service at the start of every session. If that fetch fails or is slow, hearing never
starts. Two further consequences follow:

- **Privacy expectation.** People use this app to rehearse things they may not want to
  leave their machine. Every session currently contacts an outside service they did not
  choose, which also learns when they practise.
- **Silent breakage after routine updates.** The fetched part is pinned to an older version
  than the rest of the app. A routine dependency update could break hearing for everyone,
  and nothing would say so until someone noticed they were not being heard.

## What success looks like

1. **No outside contact.** A full practice session (start, speak, interrupt, end) makes no
   request to any host other than the app itself and the speech and AI providers the
   person configured. Checked with the browser's network log on a mock-mode session.
2. **Hearing starts reliably.** 50 consecutive session starts in mock mode all begin
   listening. In one day's testing, 2 of about 12 starts failed: a small sample, but not rare.
3. **No silent failure.** If hearing still cannot start (an unsupported browser, a blocked
   file), the person sees a plain message within 10 seconds of the session opening. It says
   their voice cannot be heard and offers typing instead. The screen never shows "Listening"
   while nothing is listening.
4. **Nothing else changes.** When it works, conversations feel exactly as they do today:
   same moment of noticing they have finished speaking, same interruptions.

## Announcement (as if shipped)

> **Your sessions stay on your machine.** Voice detection now loads from Interview Studio
> itself instead of an outside service, so a session no longer depends on, or tells
> anyone about, a third-party website. It also starts reliably. If your browser can't run
> voice detection, you'll see a message straight away and can type your answers instead of
> waiting to be heard.

## Mockups

`mockups/hearing-unavailable.html`: the session screen when hearing cannot start.

## Deliberately not doing

- **No change to how speech is detected.** The sensitivity and end-of-turn behaviour stay
  exactly as they are. They are deliberately locked.
- **No microphone level indicator.** That is #49.
- **No microphone selection fix.** That is #40. It touches the same part of the app, but it
  is a separate decision about which microphone to use.
- **No promise of fully offline use.** This removes the one outside fetch that hearing
  depends on. It does not audit fonts, the speech or AI providers, or anything else, and the
  announcement must not claim "works offline".
- **No reduction in download size.** The app gets larger by the part it used to fetch: tens
  of megabytes, served from the person's own machine or server. On a local install that
  cost is negligible. Making it smaller is a separate effort.
- **No automatic retry loop.** If hearing fails to start, the message and the typing
  fallback are the answer, not silent retries that look like a hang.

## Kill check

Should this exist? Yes. Points 2 and 3 fix a real defect seen in testing. Point 1 removes a
privacy surprise that the app's own documentation never discloses. The cost is a larger
install. The risk to watch is that the change makes hearing fail differently, which success
measures 2 and 4 cover.

## Open questions for approval

1. **Include the "can't hear you" message (success point 3) in this spec, or only move the
   download?** Proposed: include it. Moving the download makes failure rarer, but a failure
   would still be silent, which is the actual harm.
2. **Wording of the message.** Proposed: "We can't hear you in this browser. Voice detection
   didn't start. You can type your answers instead." with the typing control already open.
