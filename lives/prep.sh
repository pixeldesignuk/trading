#!/bin/bash
# Prep a LOCAL live video (already downloaded from Telegram) for extraction.
# Produces audio.wav + transcript.{txt,srt,vtt} next to the video. Free (no tokens).
# Usage: prep.sh <video.mp4> <out-dir>
set -euo pipefail
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)"
VIDEO="${1:?video path}"; DIR="${2:?out dir}"
MODEL="$HOME/.cache/whisper-cpp/ggml-small.en.bin"
mkdir -p "$DIR/screenshots"

if [ ! -f "$DIR/audio.wav" ]; then
  echo "[prep] extracting 16k mono audio" >&2
  ffmpeg -y -i "$VIDEO" -ar 16000 -ac 1 -c:a pcm_s16le "$DIR/audio.wav" >/dev/null 2>&1
fi

if [ ! -f "$DIR/transcript.srt" ]; then
  echo "[prep] transcribing (whisper.cpp small.en) — a few minutes" >&2
  whisper-cli -m "$MODEL" -f "$DIR/audio.wav" -otxt -osrt -ovtt -of "$DIR/transcript" -pp >/dev/null 2>&1
fi

DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO" | cut -d. -f1)
echo "DIR=$DIR"
echo "DURATION=$DUR"
