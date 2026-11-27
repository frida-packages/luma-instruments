#!/bin/sh
set -e
cd "$(dirname "$0")"
for svg in *.svg; do
  rsvg-convert -w 128 -h 128 "$svg" -o "../${svg%.svg}/icon.png"
done
