#!/bin/bash

# Script to download historical basemaps GeoJSON data and convert to TopoJSON
# Usage: ./get-basemaps.sh

set -e

# Paths are relative to the repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

REPO_URL="https://github.com/aourednik/historical-basemaps"
TMP_DIR="$ROOT_DIR/tmp"
GEOJSON_DIR="$TMP_DIR/geojson"
TOPO_DIR="$ROOT_DIR/src/data/topo-data"
# Outside TOPO_DIR, since everything in there is bundled as a basemap (see getGeoData in lib.js).
INDEX_FILE="$ROOT_DIR/src/data/basemaps.json"

echo "Downloading historical basemaps..."

# Create temporary directory
mkdir -p "$GEOJSON_DIR"

# Download the GeoJSON files from the repository
# Using GitHub's API to get the file list, then downloading each file
GITHUB_API_URL="https://api.github.com/repos/aourednik/historical-basemaps/contents/geojson"

# Get list of files and download each one
curl -s "$GITHUB_API_URL" | \
  grep -o '"download_url": "[^"]*"' | \
  sed 's/"download_url": "\([^"]*\)"/\1/' | \
  while read -r file_url; do
    filename=$(basename "$file_url")
    curl -s -o "$GEOJSON_DIR/$filename" "$file_url"
  done

echo "Download complete, counting files..."
file_count=$(ls -1 "$GEOJSON_DIR"/*.geojson 2>/dev/null | wc -l | tr -d ' ')
echo "Downloaded $file_count GeoJSON files"

echo ""
echo "Converting to TopoJSON..."

# Convert GeoJSON to TopoJSON
"$SCRIPT_DIR/convert-to-topojson.sh" "$GEOJSON_DIR" "$TOPO_DIR"

# Clean up temporary directory
rm -rf $TMP_DIR

echo ""
echo "Indexing basemaps..."

# Index the basemaps now in TOPO_DIR, which the site reads instead of upstream's index.
"$SCRIPT_DIR/make-basemap-index.sh" "$TOPO_DIR" "$INDEX_FILE"

echo ""
echo "Done! TopoJSON files are in $TOPO_DIR, indexed in $INDEX_FILE"
