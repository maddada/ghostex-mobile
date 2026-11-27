# Waiting music: where the pieces come from

The six loops the voice agent's waiting music offers (`src/voice/waitingMusic.ts`). Each is dedicated to the public
domain by its author under **CC0 1.0 Universal** (https://creativecommons.org/publicdomain/zero/1.0/), as stated on
its OpenGameArt page. CC0 asks for no attribution; the app names the authors in Settings › Voice anyway (the Bossa Town
page asks for credit).

Pages and files read and downloaded on 2026-11-26. The licence is the uploader's statement on the page. The Bossa Town
and Coffee House Bump pages were read again before their files were used: each page's "License(s)" field shows CC0
alone, linked to the CC0 1.0 deed, for the one file the page offers.

| File | Title | Author | Source page | File downloaded | SHA-256 of the download |
|---|---|---|---|---|---|
| `ambient-relaxing-loop.m4a` | Ambient Relaxing Loop | isaiah658 | https://opengameart.org/content/ambient-relaxing-loop | https://opengameart.org/sites/default/files/Ambient-Loop-isaiah658.wav (`Ambient-Loop-isaiah658.wav`) | `8ccf91ef2b46b3286aee35811306dbf6484d462ddffb2fe5c8ab491453f39666` |
| `heavenly-loop.m4a` | Heavenly Loop | isaiah658 | https://opengameart.org/content/heavenly-loop | https://opengameart.org/sites/default/files/Heavenly%20Loop.flac (`Heavenly Loop.flac`) | `1324464c995635ce1a7833c5b3f33eba7356b60e17e802ebbf286bd1abe0a5a4` |
| `slow-stride.m4a` | Slow Stride | isaiah658 | https://opengameart.org/content/slow-stride | https://opengameart.org/sites/default/files/Slow%20Stride%20Loop.flac (`Slow Stride Loop.flac`) | `42598ee6d19ccc9b2659a6a4bde081aab0e8d0ea8fc6d97428d46803653ab337` |
| `calm-loop.m4a` | Calm Loop | wipics | https://opengameart.org/content/calm-loop | https://opengameart.org/sites/default/files/Relaxing_0.mp3 (the page lists it as `Relaxing.mp3`) | `1d7e386c079d4add6b3b1592054846e4977035f26844466e409467c6dc7bdbde` |
| `bossa-town.m4a` | Bossa Town | KarateStudios | https://opengameart.org/content/bossa-town | https://opengameart.org/sites/default/files/Bossa%20Town.wav_2.flac (the page lists it as `Bossa Town.wav.flac`) | `526a8407931e5c0ca314fa0ea26edd417f540c160eb93372f4b10a27bf5a70d9` |
| `coffee-house-bump.m4a` | Coffee House Bump | OatCog | https://opengameart.org/content/coffee-house-bump | https://opengameart.org/sites/default/files/little_cafe_0.wav (the page lists it as `little_cafe.wav`) | `bb2668c05173600c90b68f6192f7b7316582af18d9a28acc3f7fc98a3c8339ce` |

## Conversion

Every piece is mono AAC-LC at 64 kbit/s and 44.1 kHz in an `.m4a`, encoded by macOS `afconvert`, which records the
encoder's priming and remainder frames, so the decoded file has exactly the loop's length and loops without a gap. Mono
because a call's route (loudspeaker, Bluetooth hands-free, CarPlay) plays the call in mono.

Two steps per piece:

1. `ffmpeg` writes a 32-bit float WAV: only leading and trailing silence (below -60 dBFS) is trimmed, and one static
   gain brings each piece to the same loudness, -22 LUFS after the mono downmix, so one volume setting means the same
   for all six. No compression and no limiting. Bossa Town is first made into a loop (below).
2. `afconvert -f m4af -d aac -c 1 --mix -b 64000 -q 127 <piece>.wav <piece>.m4a`

| File | Trimmed | Gain | Commands |
|---|---|---|---|
| `ambient-relaxing-loop.m4a` | nothing (no silence at either end) | -0.2 dB | `ffmpeg -i Ambient-Loop-isaiah658.wav -af 'volume=-0.2dB' -c:a pcm_f32le ambient-relaxing-loop.wav`, then step 2 |
| `heavenly-loop.m4a` | nothing (no silence at either end) | +5.1 dB | `ffmpeg -i 'Heavenly Loop.flac' -af 'volume=5.1dB' -c:a pcm_f32le heavenly-loop.wav`, then step 2 |
| `slow-stride.m4a` | nothing (no silence at either end) | -1.3 dB | `ffmpeg -i 'Slow Stride Loop.flac' -af 'volume=-1.3dB' -c:a pcm_f32le slow-stride.wav`, then step 2 |
| `calm-loop.m4a` | 234 frames (5.3 ms) of leading and 5510 frames (124.9 ms) of trailing silence, the MP3's padding: frames 234 to 849273 of 854784 are kept | -9.6 dB | `ffmpeg -i Relaxing.mp3 -af 'atrim=start_sample=234:end_sample=849274,asetpts=N/SR/TB,volume=-9.6dB' -c:a pcm_f32le calm-loop.wav`, then step 2 |
| `bossa-town.m4a` | the song's 48 kHz is resampled to 44.1 kHz as a whole, then its 2nd to 25th bar are kept as the loop (below) | +1.2 dB | `ffmpeg -i 'Bossa Town.wav_2.flac' -af 'aresample=44100:filter_size=256:phase_shift=10:cutoff=0.97' -c:a pcm_f32le bossa-town.44k.wav`; `ffmpeg -i bossa-town.44k.wav -filter_complex '[0]asplit=3[h][t][b];[h]atrim=start_sample=119070:end_sample=145530,asetpts=N/SR/TB,afade=t=in:start_sample=0:nb_samples=26460:curve=tri[hi];[t]atrim=start_sample=2659230:end_sample=2685690,asetpts=N/SR/TB,afade=t=out:start_sample=0:nb_samples=26460:curve=tri[to];[hi][to]amix=inputs=2:normalize=0:duration=longest[x];[b]atrim=start_sample=145530:end_sample=2659230,asetpts=N/SR/TB[body];[x][body]concat=n=2:v=0:a=1[out]' -map '[out]' -c:a pcm_f32le bossa-town.loop.wav`; `ffmpeg -i bossa-town.loop.wav -af 'volume=1.2dB' -c:a pcm_f32le bossa-town.wav`, then step 2 |
| `coffee-house-bump.m4a` | nothing: the file is exactly 65 bars at 100 bpm (156.000 s) and its page tags it as a loop; its last 2.16 s below -60 dBFS are the rest of the last bar, so trimming them would restart the loop early | -1.2 dB | `ffmpeg -i little_cafe_0.wav -c:a pcm_f32le coffee-house-bump.loop.wav`; `ffmpeg -i coffee-house-bump.loop.wav -af 'volume=-1.2dB' -c:a pcm_f32le coffee-house-bump.wav`, then step 2 |

Bossa Town is a song with an intro and an ending, not a loop, and its repeats are not sample-identical, so it has no
loop point that is seamless without a crossfade. Its loop is the song's 2nd to 25th bar at 100 bpm (44.1 kHz frames
119070 to 2659229, 2.7 s to 60.3 s of the song, 57.6 s): the 26th bar restates the 2nd, so going from the end of the
25th back to the 2nd is the song's own return to its theme. The loop's first 26460 frames (0.6 s, one beat) are a
linear crossfade from what follows the 25th bar in the song (fading out) into the 2nd (fading in), so the step from the
loop's last sample to its first is the song's own step from frame 2659229 to 2659230.

Checked after encoding: each `.m4a` decodes (CoreAudio) to exactly as many frames as its WAV, and the step from its
last sample to its first is smaller than the 99th percentile of the steps between neighbouring samples inside the
piece, so the loop point has no click.
