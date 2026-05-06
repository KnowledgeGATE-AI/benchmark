# Video Intelligence Model Benchmark Suite

Unified benchmark harness for testing MLX models used in the Video Intelligence Pipeline:

| Benchmark | Model Type | Use Case |
|-----------|------------|----------|
| **Image-to-Text** | VLM (Vision-Language) | Phase 1: Screenshot descriptions |
| **Text-to-Text** | LLM | Phase 2 & 4: Summary compression |
| **Audio-to-Text** | Whisper | Phase 3: Audio transcription |

## Selected Models

| Phase | Model | Speed | Notes |
|-------|-------|-------|-------|
| **Phase 1** | Qwen2.5-VL-7B-4bit | 13.8s/image | Best quality/speed for educational content |
| **Phase 2 & 4** | Qwen2.5-3B-4bit | 5.3s/sample | **SELECTED** - Fastest, same family as VLM |
| **Phase 3** | distil-whisper-large-v3 | 15x realtime | **SELECTED** - Fastest whisper variant |

### Audio-to-Text Benchmark Results (2024-12-20)

| Model | Size | Total Time | Realtime Ratio | Notes |
|-------|------|------------|----------------|-------|
| **distil-whisper-large-v3** | ~750M | 13.0s | 15.0x | **SELECTED** - Fastest, excellent quality |
| whisper-large-v3-turbo | ~800M | 13.7s | 14.3x | Very close second, OpenAI's pruned version |
| whisper-medium | ~750M | 23.8s | 10.4x | Good fallback option |

*Tested on 3.2 min of TTS-generated educational audio. Realtime ratio = audio duration / processing time.*

### Text-to-Text Benchmark Results (2024-12-20)

| Model | Size | Avg Time | Tok/s | Memory | Notes |
|-------|------|----------|-------|--------|-------|
| **Qwen2.5-3B-4bit** | 3B | 5.3s | 130.8 | 2.5GB | **SELECTED** - Same family as VLM |
| Llama-3.2-3B-4bit | 3B | 7.3s | 80.3 | 2.4GB | Good but slower |
| Gemma-2-2B-4bit | 2B | 11.7s | 47.9 | 2.3GB | Smallest but slowest |

## Quick Start

```bash
# Navigate to benchmark venv
cd ~/mlx-vlm-bench
source venv/bin/activate

# Install dependencies (if needed)
pip install mlx-vlm mlx-lm mlx-whisper

# Run benchmarks from project root
cd /path/to/KGAI

# Image-to-text (existing)
python scripts/vlm-bench/run_benchmark.py --fast

# Text-to-text (new)
python scripts/vlm-bench/bench-text-to-text.py --fast

# Audio-to-text (new)
python scripts/vlm-bench/bench-audio-to-text.py --fast
```

## Directory Structure

```
scripts/vlm-bench/
├── run_benchmark.py        # Image-to-text (VLM) benchmark
├── bench-text-to-text.py   # Text summarization benchmark
├── bench-audio-to-text.py  # Whisper transcription benchmark
├── test-data/
│   ├── images/             # Sample lecture screenshots
│   ├── texts/              # Sample VLM descriptions (auto-generated)
│   └── audio/              # Sample lecture audio clips
├── results/                # Benchmark results (JSON + CSV)
└── README.md               # This file
```

## Image-to-Text Benchmark (Phase 1)

Tests VLM models on educational screenshot description.

```bash
# Run all models
python scripts/vlm-bench/run_benchmark.py

# Run specific models
python scripts/vlm-bench/run_benchmark.py --models "Qwen2.5-VL-7B"

# Run only fast models
python scripts/vlm-bench/run_benchmark.py --fast

# List available models
python scripts/vlm-bench/run_benchmark.py --list-models
```

**Test Data**: Place .jpg/.png screenshots in `~/mlx-vlm-bench/images10/`

**Selected**: `mlx-community/Qwen2.5-VL-7B-Instruct-4bit` (13.8s/image, 113 avg words)

## Text-to-Text Benchmark (Phase 2 & 4)

Tests LLM models on compressing VLM descriptions into summaries.

```bash
# Run all models
python scripts/vlm-bench/bench-text-to-text.py

# Run specific models
python scripts/vlm-bench/bench-text-to-text.py --models "Qwen2.5-3B" "Llama"

# Run only small models (<5B)
python scripts/vlm-bench/bench-text-to-text.py --fast

# List available models
python scripts/vlm-bench/bench-text-to-text.py --list-models
```

**Test Data**: Auto-generated sample VLM descriptions in `test-data/texts/`

**Candidates**:
| Model | Size | Notes |
|-------|------|-------|
| Qwen2.5-3B-4bit | 3B | Same family as VLM |
| Qwen2.5-7B-4bit | 7B | Higher quality |
| Llama-3.2-3B-4bit | 3B | Meta's efficient model |
| Mistral-7B-v0.3-4bit | 7B | Strong reasoning |
| Gemma-2-2B-4bit | 2B | Very fast |

## Audio-to-Text Benchmark (Phase 3)

Tests Whisper models on lecture audio transcription.

```bash
# Run all models
python scripts/vlm-bench/bench-audio-to-text.py

# Run specific models
python scripts/vlm-bench/bench-audio-to-text.py --models "large-v3-turbo"

# Run only turbo/distil models
python scripts/vlm-bench/bench-audio-to-text.py --fast

# List available models
python scripts/vlm-bench/bench-audio-to-text.py --list-models
```

**Test Data**: Place .mp3/.wav audio clips in `test-data/audio/`

Create test audio from videos:
```bash
# Extract 3-minute clip
ffmpeg -i video.mp4 -ss 00:01:00 -t 00:03:00 -vn -ar 16000 -ac 1 clip.mp3
```

**Candidates**:
| Model | Size | Notes |
|-------|------|-------|
| whisper-large-v3-turbo | ~800M | OpenAI's 8x faster version |
| distil-whisper-large-v3 | ~750M | Distilled, very fast |
| whisper-large-v3 | ~1.5GB | Full quality reference |
| whisper-medium | ~750M | Good balance |

## Results

Results are saved to `results/` directory:
- `*_YYYYMMDD_HHMMSS.csv` - Summary metrics
- `*_YYYYMMDD_HHMMSS.json` - Full output with text/transcripts

## Benchmark Criteria

### Image-to-Text (VLM)
- Speed (seconds per image)
- Output quality (educational relevance)
- JSON format consistency
- Memory usage

### Text-to-Text (LLM)
- Speed (tokens per second)
- Compression quality
- Coherence of output
- Timestamp preservation

### Audio-to-Text (Whisper)
- Realtime ratio (5x = transcribes 5 min in 1 min)
- Word Error Rate (WER) - manual evaluation
- Timestamp accuracy
- Technical vocabulary handling

## Environment

All benchmarks use the same Python venv at `~/mlx-vlm-bench/venv/`:

```bash
cd ~/mlx-vlm-bench
python3 -m venv venv
source venv/bin/activate
pip install mlx-vlm mlx-lm mlx-whisper
```

Required for audio benchmarks:
```bash
brew install ffmpeg  # For audio duration detection
```
