#!/bin/bash

# Write an index of the historical basemaps in a TopoJSON directory: a JSON
# array of { "year": <number>, "filename": <string> }, sorted by year.
# BCE years are negative (world_bc5000.json -> -5000).
#
# Built from the files actually present, so the index always matches the
# basemaps the site can load.
#
# Usage: ./make-basemap-index.sh <topojson_dir> <output_file>

set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <topojson_directory> <output_file>"
    echo "Example: $0 ./src/data/topo-data ./src/data/basemaps.json"
    exit 1
fi

TOPO_DIR="$1"
OUTPUT_FILE="$2"

if [ ! -d "$TOPO_DIR" ]; then
    echo "Error: TopoJSON directory '$TOPO_DIR' does not exist"
    exit 1
fi

# Basemaps are named world_<year>.json or world_bc<year>.json. Anything else
# in the directory (e.g. places.json) is not a basemap.
shopt -s nullglob
files=("$TOPO_DIR"/world_*.json)
if [ "${#files[@]}" -eq 0 ]; then
    echo "Error: no world_*.json basemaps in '$TOPO_DIR'"
    exit 1
fi

# One "year<TAB>filename" line per basemap, sorted by year, then formatted as JSON.
entries=$(
    for file in "${files[@]}"; do
        name=$(basename "$file")
        year=${name#world_}
        year=${year%.json}
        if [[ "$year" == bc* ]]; then
            year="-${year#bc}"
        fi
        if [[ ! "$year" =~ ^-?[0-9]+$ ]]; then
            echo "Skipping $name: can't read a year from its name" >&2
            continue
        fi
        printf '%s\t%s\n' "$year" "$name"
    done | sort -n | awk -F'\t' '{
        printf "%s  { \"year\": %s, \"filename\": \"%s\" }", (NR > 1 ? ",\n" : ""), $1, $2
    }'
)

# Write to a temporary file first, so a failure never leaves a half-written index.
tmp_file="$OUTPUT_FILE.tmp"
printf '[\n%s\n]\n' "$entries" > "$tmp_file"
mv "$tmp_file" "$OUTPUT_FILE"

count=$(grep -c '"year"' "$OUTPUT_FILE")
echo "Wrote an index of $count basemaps to $OUTPUT_FILE"
