# e2e fixtures

Generated test media. Nothing here is a recording of a real person or interview.

| File | Used by | Made with |
|---|---|---|
| `silence-250ms.mp3` | `e2e/support/session.ts` (`proxySession` replaces the mock's 4-byte TTS frames with it so playback really happens) | `ffmpeg -f lavfi -i anullsrc=r=24000:cl=mono -t 0.25 -c:a libmp3lame -b:a 32k silence-250ms.mp3` (1,485 bytes, above the client's 512-byte minimum) |
