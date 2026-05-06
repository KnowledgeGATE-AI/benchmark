# Test Audio for Whisper Benchmark

Add 2-5 educational audio clips here for benchmarking.

## Recommended Format
- Duration: 2-5 minutes each
- Format: MP3 or WAV
- Sample rate: 16kHz (Whisper's native rate)
- Clear speech, minimal background noise

## Creating Test Audio from Videos

Extract audio from educational videos:

```bash
# Extract 3-minute clip starting at 1 minute
ffmpeg -i lecture.mp4 -ss 00:01:00 -t 00:03:00 -vn -ar 16000 -ac 1 clip1.mp3

# Extract another clip
ffmpeg -i lecture.mp4 -ss 00:10:00 -t 00:03:00 -vn -ar 16000 -ac 1 clip2.mp3
```

## Ideal Content
- Educational lectures with clear pronunciation
- Some technical terms (to test vocabulary handling)
- Mix of speaking speeds
- Minimal background music/noise
