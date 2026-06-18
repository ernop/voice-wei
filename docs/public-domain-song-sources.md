# Public-Domain Song Sources

The player imports local `.mid`, `.midi`, `.musicxml`, and `.xml` files. Use
`./download-public-domain-songs.sh` to download symbolic public-domain corpora
into `.dev/song-sources`, which is ignored by git.

## Sources

- **OpenScore Lieder**: vocal songs, CC0/public-domain corpus. The script
  downloads the Zenodo release for `OpenScore/Lieder`, which contains MuseScore
  XML sources. Install MuseScore CLI (`mscore`, `musescore`, `musescore3`, or
  `musescore4`) and rerun the script to batch-convert it to `.mid` and
  `.musicxml`.
- **Mutopia Project**: public-domain/open sheet music in LilyPond. The script
  clones the GitHub source repo and mirrors generated `.mid` files from
  `mutopiaproject.org` into `.dev/song-sources/mutopia-midi`.
- **PDMX**: very large MuseScore-derived MusicXML/MIDI/PDF dataset. The script
  leaves this opt-in behind `--include-pdmx` because the Zenodo archive is large
  and the dataset has metadata reliability caveats.

## Local Import Path

After the default script run, start with:

```text
.dev/song-sources/mutopia-midi/**/*.mid
```

OpenScore Lieder becomes directly importable after MuseScore conversion:

```text
.dev/song-sources/openscore-lieder/**/*.mid
.dev/song-sources/openscore-lieder/**/*.musicxml
```
